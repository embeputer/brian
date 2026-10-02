#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";
import { SyntaxKind } from "typescript/unstable/ast";
import {
	isCallExpression,
	isExportDeclaration,
	isIdentifier,
	isImportDeclaration,
	isNamedExports,
	isNamedImports,
	isNoSubstitutionTemplateLiteral,
	isPropertyAccessExpression,
	isStringLiteral,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";
import { getPublicWorkspacePackages } from "./release-packages.mjs";

// Packages without tsconfig.build.json are checked against a synthetic config.
const fallbackConfigName = "tsconfig.runtime-deps-fallback.json";
const fallbackConfig = JSON.stringify({ include: ["src/**/*"] });
// Local package import targets (such as `.mjs` driver wrappers) are often outside
// the build's include pattern, so each package gets a synthetic project for them.
const importTargetsConfigName = "tsconfig.runtime-deps-import-targets.json";
const failures = [];

function localImportTargets(target) {
	if (typeof target === "string") return target.startsWith("./") ? [target] : [];
	if (Array.isArray(target)) return target.flatMap(localImportTargets);
	if (target && typeof target === "object") {
		return Object.entries(target).flatMap(([condition, entry]) => (condition === "types" ? [] : localImportTargets(entry)));
	}
	return [];
}

function checkSource(source, pkg) {
	const { manifest, directory, checkedSources } = pkg;
	const file = resolve(source.fileName);
	if (checkedSources.has(file)) return;
	checkedSources.add(file);
	const declared = new Set([
		manifest.name,
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);

	function checkImportTarget(target, node, seen) {
		if (typeof target === "string") {
			if (target.startsWith("./")) {
				const targetPath = resolve(directory, target);
				const path = relative(resolve(directory, "src"), targetPath);
				if (path.startsWith("..") || isAbsolute(path) || !existsSync(targetPath)) {
					failures.push(`${file}: package import target ${target} must name an existing file inside src`);
				} else {
					checkSource(pkg.importTargetSource(targetPath), pkg);
				}
			} else {
				checkRuntimeSpecifier(target, node, seen);
			}
		} else if (Array.isArray(target)) {
			for (const entry of target) checkImportTarget(entry, node, seen);
		} else if (target && typeof target === "object") {
			for (const [condition, entry] of Object.entries(target)) {
				if (condition !== "types") checkImportTarget(entry, node, seen);
			}
		}
	}

	function checkRuntimeSpecifier(specifier, node, seen = new Set()) {
		// `cloudflare:` and `bun:` modules are built into Workers and Bun, like `node:` modules are into Node.
		if (
			specifier.startsWith(".") ||
			specifier.startsWith("/") ||
			specifier.startsWith("cloudflare:") ||
			specifier.startsWith("bun:") ||
			isBuiltin(specifier)
		) {
			return;
		}
		if (specifier.startsWith("#") && Object.hasOwn(manifest.imports ?? {}, specifier)) {
			if (seen.has(specifier)) {
				failures.push(`${file}: package import ${specifier} has a cyclic target`);
				return;
			}
			checkImportTarget(manifest.imports[specifier], node, new Set([...seen, specifier]));
			return;
		}
		const name = specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
		if (declared.has(name)) return;
		const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
		failures.push(`${file}:${line + 1}: ${specifier} is not declared in ${manifest.name}'s runtime dependencies`);
	}

	function checkSpecifier(node) {
		if (node && (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node))) checkRuntimeSpecifier(node.text, node);
	}

	function visit(node) {
		if (isImportDeclaration(node)) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			if (
				!clause ||
				(clause.phaseModifier !== SyntaxKind.TypeKeyword &&
					(clause.name ||
						!bindings ||
						!isNamedImports(bindings) ||
						bindings.elements.length === 0 ||
						bindings.elements.some((element) => !element.isTypeOnly)))
			) {
				checkSpecifier(node.moduleSpecifier);
			}
		} else if (isExportDeclaration(node) && !node.isTypeOnly) {
			const clause = node.exportClause;
			if (
				!clause ||
				!isNamedExports(clause) ||
				clause.elements.length === 0 ||
				clause.elements.some((element) => !element.isTypeOnly)
			) {
				checkSpecifier(node.moduleSpecifier);
			}
		} else if (
			isCallExpression(node) &&
			(node.expression.kind === SyntaxKind.ImportKeyword ||
				(isIdentifier(node.expression) && node.expression.text === "require") ||
				(isPropertyAccessExpression(node.expression) && node.expression.getText(source) === "require.resolve"))
		) {
			checkSpecifier(node.arguments[0]);
		}
		node.forEachChild(visit);
	}
	visit(source);
}

const packages = getPublicWorkspacePackages()
	.map(({ directory }) => ({ directory, sourceDirectory: resolve(directory, "src") }))
	.filter(({ sourceDirectory }) => existsSync(sourceDirectory))
	.map(({ directory, sourceDirectory }) => {
		const configPath = resolve(directory, "tsconfig.build.json");
		const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
		const importTargets = [
			...new Set(Object.values(manifest.imports ?? {}).flatMap(localImportTargets)),
		].filter((target) => {
			const path = relative(sourceDirectory, resolve(directory, target));
			return !path.startsWith("..") && !isAbsolute(path) && existsSync(resolve(directory, target));
		});
		return {
			directory,
			sourceDirectory,
			manifest,
			configPath: existsSync(configPath) ? configPath : resolve(directory, fallbackConfigName),
			importTargetsConfigPath: importTargets.length > 0 ? resolve(directory, importTargetsConfigName) : undefined,
			importTargets,
		};
	});

const syntheticConfigs = new Map();
for (const { configPath, importTargetsConfigPath, importTargets } of packages) {
	if (configPath.endsWith(fallbackConfigName)) syntheticConfigs.set(configPath, fallbackConfig);
	if (importTargetsConfigPath) {
		syntheticConfigs.set(
			importTargetsConfigPath,
			JSON.stringify({ compilerOptions: { allowJs: true, noEmit: true }, files: importTargets }),
		);
	}
}
const api = new API({
	cwd: process.cwd(),
	fs: {
		fileExists: (fileName) => (syntheticConfigs.has(resolve(fileName)) ? true : undefined),
		readFile: (fileName) => syntheticConfigs.get(resolve(fileName)),
	},
});
try {
	const snapshot = api.updateSnapshot({ openProjects: [...syntheticConfigs.keys(), ...packages.map(({ configPath }) => configPath)] });
	for (const { directory, sourceDirectory, manifest, configPath, importTargetsConfigPath } of packages) {
		const project = snapshot.getProject(configPath);
		const importTargetsProgram = importTargetsConfigPath ? snapshot.getProject(importTargetsConfigPath).program : undefined;
		const pkg = {
			manifest,
			directory,
			checkedSources: new Set(),
			importTargetSource: (path) => importTargetsProgram.getSourceFile(path),
		};
		const diagnostics = project.program.getConfigFileParsingDiagnostics();
		if (diagnostics.length > 0) throw new Error(diagnostics.map((diagnostic) => diagnostic.text).join("\n"));
		const roots = new Set(project.rootFiles.map((file) => resolve(file)));
		for (const fileName of project.program.getSourceFileNames()) {
			if (fileName.endsWith(".d.ts") || fileName.endsWith(".json")) continue;
			const path = relative(sourceDirectory, resolve(fileName));
			if (path.startsWith("..") || isAbsolute(path)) continue;
			// TypeScript's exclude only filters roots: imports can pull excluded files
			// back into the build. Reject that too, including type-only imports.
			if (!roots.has(resolve(fileName))) {
				failures.push(`${fileName} is excluded from ${manifest.name}'s build but imported by it`);
			}
			checkSource(project.program.getSourceFile(fileName), pkg);
		}
	}
} finally {
	api.close();
}

if (failures.length > 0) {
	console.error("Undeclared runtime imports in public packages:");
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log("Public package runtime imports have declared dependencies.");
