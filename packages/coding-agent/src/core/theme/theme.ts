import * as fs from "node:fs";
import * as path from "node:path";
import type { ThinkingLevel } from "@brian-agent/agent";
import chalk from "chalk";
import { getThemesDir } from "../../config.ts";
import {
	backgroundAnsi,
	type Color,
	colorToHex,
	colorToOklch,
	foregroundAnsi,
	indexedColor,
	mixColors,
	parseColor,
	rgbColor,
	styleTextWithAnsi,
	type TerminalColorMode,
	type TextAttributes,
} from "../../utils/colors.ts";
import { highlight, supportsLanguage } from "../../utils/syntax-highlight.ts";
import { stripBom } from "../../utils/text.ts";
import type { SourceInfo } from "../source-info.ts";
import {
	type ResolvedThemeColorValues,
	THEME_TOKENS,
	type ThemeBg,
	type ThemeColor,
	type ThemeColorValues,
	type ThemeToken,
} from "./theme-tokens.ts";

export type { ThemeBg, ThemeColor, ThemeToken } from "./theme-tokens.ts";

/**
 * Brian has no terminal UI, so it ships one fixed theme (`dark.json`). It colors HTML exports and the
 * ANSI output of tool renderers.
 */

/**
 * Tokens are only accepted in their own slot, because "" (terminal default) means the default foreground
 * or background depending on the slot. Use `theme.colors[token]` to use a token's color in the other slot.
 */
export interface ThemeStyle extends TextAttributes {
	fg?: ThemeColor | Color;
	bg?: ThemeBg | Color;
}

/** The background a theme is designed for. */
export type ThemeAppearance = "dark" | "light";

type ColorValue = string | number;

interface ThemeJson {
	name?: string;
	appearance?: ThemeAppearance;
	vars?: Record<string, ColorValue>;
	colors: ThemeColorValues<ColorValue>;
	export?: { pageBg?: ColorValue; cardBg?: ColorValue; infoBg?: ColorValue };
}

// No terminal reports its colors to a headless agent.
const terminalColors: TerminalColors = {};

// ============================================================================
// Color Utilities
// ============================================================================

function resolveVarRefs(
	value: ColorValue,
	vars: Record<string, ColorValue>,
	visited = new Set<string>(),
): string | number {
	if (typeof value === "number" || value === "" || value.startsWith("#") || /^ok(lch|hsl)\(/i.test(value)) {
		return value;
	}
	if (visited.has(value)) {
		throw new Error(`Circular variable reference detected: ${value}`);
	}
	if (!(value in vars)) {
		throw new Error(`Variable reference not found: ${value}`);
	}
	visited.add(value);
	return resolveVarRefs(vars[value], vars, visited);
}

function resolveThemeColors<T extends Record<string, ColorValue>>(
	colors: T,
	vars: Record<string, ColorValue> = {},
): Record<keyof T, string | number> {
	const resolved: Record<string, string | number> = {};
	for (const [key, value] of Object.entries(colors)) {
		resolved[key] = resolveVarRefs(value, vars);
	}
	return resolved as Record<keyof T, string | number>;
}

function withThemeTokenFallbacks<Value>(values: ThemeColorValues<Value>): ResolvedThemeColorValues<Value> {
	const resolved = { ...values } as Partial<ResolvedThemeColorValues<Value>>;
	for (const [rawName, descriptor] of Object.entries(THEME_TOKENS)) {
		if (!("fallback" in descriptor)) continue;
		const name = rawName as ThemeToken;
		if (resolved[name] !== undefined) continue;
		const fallback = descriptor.fallback as ThemeToken;
		const fallbackValue = resolved[fallback];
		if (fallbackValue === undefined) {
			throw new Error(`Theme token ${rawName} has unresolved fallback ${descriptor.fallback}`);
		}
		resolved[name] = fallbackValue;
	}
	return resolved as ResolvedThemeColorValues<Value>;
}

/** Assumed terminal default colors when the terminal does not report them. */
const GUESSED_DEFAULT_COLORS: Record<ThemeAppearance, { foreground: Color; background: Color }> = {
	dark: { foreground: parseColor("#e5e5e7"), background: parseColor("#000000") },
	light: { foreground: parseColor("#000000"), background: parseColor("#ffffff") },
};

function averageLightness(colors: Color[]): number | undefined {
	// Palette colors 0-15 follow the user's terminal palette, so they say nothing about the theme.
	const fixed = colors.filter((color) => color.kind !== "indexed" || color.index >= 16);
	if (fixed.length === 0) return undefined;
	return fixed.reduce((sum, color) => sum + colorToOklch(color).l, 0) / fixed.length;
}

/** Detect the background a theme is designed for from the lightness of its own colors. */
function detectAppearance(foregrounds: Color[], backgrounds: Color[]): ThemeAppearance | undefined {
	const fg = averageLightness(foregrounds);
	const bg = averageLightness(backgrounds);
	if (fg !== undefined && bg !== undefined) return bg < fg ? "dark" : "light";
	if (bg !== undefined) return bg < 0.5 ? "dark" : "light";
	if (fg !== undefined) return fg > 0.5 ? "dark" : "light";
	return undefined;
}

// ============================================================================
// Theme Class
// ============================================================================

export class Theme {
	readonly name?: string;
	readonly sourcePath?: string;
	sourceInfo?: SourceInfo;
	private mode: TerminalColorMode;
	// Precomputed escape sequences keep fg()/bg() on the render hot path to a lookup and concat.
	private readonly fgAnsi = new Map<ThemeColor, string>();
	private readonly bgAnsi = new Map<ThemeBg, string>();
	// Tokens set to "" have no color of their own; `colors` fills them from the terminal defaults.
	private readonly concreteColors: Partial<Record<ThemeToken, Color>> = {};
	private readonly defaultForegroundTokens: ThemeToken[] = [];
	private readonly defaultBackgroundTokens: ThemeToken[] = [];
	// Foreground tokens rendered faint (SGR 2) on top of their color.
	private readonly dimTokens: ReadonlySet<ThemeColor>;
	private readonly ownAppearance: ThemeAppearance | undefined;
	private resolvedColors: { terminal: TerminalColors; colors: Readonly<Record<ThemeToken, Color>> } | undefined;

	constructor(
		fgColors: Pick<ThemeColorValues<string | number>, ThemeColor>,
		bgColors: Pick<ThemeColorValues<string | number>, ThemeBg>,
		mode: TerminalColorMode,
		options: {
			name?: string;
			sourcePath?: string;
			sourceInfo?: SourceInfo;
			appearance?: ThemeAppearance;
			/** Foreground tokens to render faint (SGR 2). */
			dim?: readonly ThemeColor[];
		} = {},
	) {
		this.name = options.name;
		this.sourcePath = options.sourcePath;
		this.sourceInfo = options.sourceInfo;
		this.mode = mode;
		this.dimTokens = new Set(options.dim);
		const { fgColors: foregrounds, bgColors: backgrounds } = splitThemeColors(
			withThemeTokenFallbacks({ ...fgColors, ...bgColors }),
		);
		const concreteForegrounds: Color[] = [];
		const concreteBackgrounds: Color[] = [];
		// Returns the escape sequence for the token's own slot.
		const addToken = (token: ThemeToken, value: string | number, isBackground: boolean): string => {
			if (value === "") {
				(isBackground ? this.defaultBackgroundTokens : this.defaultForegroundTokens).push(token);
				return isBackground ? "\x1b[49m" : "\x1b[39m";
			}
			const color = parseColor(value);
			this.concreteColors[token] = color;
			(isBackground ? concreteBackgrounds : concreteForegrounds).push(color);
			return isBackground ? backgroundAnsi(color, mode) : foregroundAnsi(color, mode);
		};
		for (const [token, value] of Object.entries(foregrounds) as [ThemeColor, string | number][]) {
			this.fgAnsi.set(token, addToken(token, value, false));
		}
		for (const [token, value] of Object.entries(backgrounds) as [ThemeBg, string | number][]) {
			this.bgAnsi.set(token, addToken(token, value, true));
		}
		this.ownAppearance = options.appearance ?? detectAppearance(concreteForegrounds, concreteBackgrounds);
	}

	/** The background the theme is designed for: declared in the theme JSON or detected from its colors. */
	get appearance(): ThemeAppearance {
		return this.ownAppearance ?? "dark";
	}

	/**
	 * Concrete colors for all tokens. Tokens set to "" (terminal default) use a guess based on
	 * `appearance`. Faint tokens are approximated by mixing their color toward the background.
	 */
	get colors(): Readonly<Record<ThemeToken, Color>> {
		const terminal = terminalColors;
		if (this.resolvedColors?.terminal !== terminal) {
			const guess = GUESSED_DEFAULT_COLORS[this.appearance];
			const toColor = (rgb: RgbColor | undefined, fallback: Color) =>
				rgb ? rgbColor(rgb.r, rgb.g, rgb.b) : fallback;
			const foreground = toColor(terminal.foreground, guess.foreground);
			const background = toColor(terminal.background, guess.background);
			const colors = { ...this.concreteColors };
			for (const token of this.defaultForegroundTokens) colors[token] = foreground;
			for (const token of this.defaultBackgroundTokens) colors[token] = background;
			for (const token of this.dimTokens) {
				const color = colors[token];
				if (color) colors[token] = mixColors(color, background, 0.4);
			}
			this.resolvedColors = { terminal, colors: Object.freeze(colors as Record<ThemeToken, Color>) };
		}
		return this.resolvedColors.colors;
	}

	style(text: string, options: ThemeStyle): string {
		const { fg, bg } = options;
		if (typeof fg === "string" && this.dimTokens.has(fg)) options = { ...options, dim: true };
		return styleTextWithAnsi(
			text,
			fg === undefined
				? undefined
				: typeof fg === "string"
					? this.tokenAnsi(this.fgAnsi, fg)
					: foregroundAnsi(fg, this.mode),
			bg === undefined
				? undefined
				: typeof bg === "string"
					? this.tokenAnsi(this.bgAnsi, bg)
					: backgroundAnsi(bg, this.mode),
			options,
		);
	}

	fg(color: ThemeColor, text: string): string {
		const ansi = this.tokenAnsi(this.fgAnsi, color);
		if (this.dimTokens.has(color)) return `${ansi}\x1b[2m${text}\x1b[22;39m`;
		return `${ansi}${text}\x1b[39m`;
	}

	bg(color: ThemeBg, text: string): string {
		const ansi = this.tokenAnsi(this.bgAnsi, color);
		return `${ansi}${text}\x1b[49m`;
	}

	private tokenAnsi<T extends ThemeToken>(ansi: Map<T, string>, token: T): string {
		const value = ansi.get(token);
		if (value === undefined) throw new Error(`Unknown theme color: ${token}`);
		return value;
	}

	bold(text: string): string {
		return chalk.bold(text);
	}

	italic(text: string): string {
		return chalk.italic(text);
	}

	underline(text: string): string {
		return chalk.underline(text);
	}

	inverse(text: string): string {
		return chalk.inverse(text);
	}

	strikethrough(text: string): string {
		return chalk.strikethrough(text);
	}

	/** Opening escape sequence for a foreground token. Faint tokens include SGR 2, which `\x1b[22m` closes. */
	getFgAnsi(color: ThemeColor): string {
		const ansi = this.tokenAnsi(this.fgAnsi, color);
		return this.dimTokens.has(color) ? `${ansi}\x1b[2m` : ansi;
	}

	getBgAnsi(color: ThemeBg): string {
		return this.tokenAnsi(this.bgAnsi, color);
	}

	getColorMode(): TerminalColorMode {
		return this.mode;
	}

	getThinkingBorderColor(level: ThinkingLevel): (str: string) => string {
		// Map thinking levels to dedicated theme colors
		switch (level) {
			case "off":
				return (str: string) => this.fg("thinkingOff", str);
			case "minimal":
				return (str: string) => this.fg("thinkingMinimal", str);
			case "low":
				return (str: string) => this.fg("thinkingLow", str);
			case "medium":
				return (str: string) => this.fg("thinkingMedium", str);
			case "high":
				return (str: string) => this.fg("thinkingHigh", str);
			case "xhigh":
				return (str: string) => this.fg("thinkingXhigh", str);
			case "max":
				return (str: string) => this.fg("thinkingMax", str);
			default:
				return (str: string) => this.fg("thinkingOff", str);
		}
	}

	getBashModeBorderColor(): (str: string) => string {
		return (str: string) => this.fg("bashMode", str);
	}
}

// ============================================================================
// The Built-in Theme
// ============================================================================

let builtinThemeJson: ThemeJson | undefined;

function getBuiltinThemeJson(): ThemeJson {
	builtinThemeJson ??= JSON.parse(
		stripBom(fs.readFileSync(path.join(getThemesDir(), "dark.json"), "utf-8")),
	) as ThemeJson;
	return builtinThemeJson;
}

function splitThemeColors(colors: ResolvedThemeColorValues<string | number>): {
	fgColors: Record<ThemeColor, string | number>;
	bgColors: Record<ThemeBg, string | number>;
} {
	const fgColors = {} as Record<ThemeColor, string | number>;
	const bgColors = {} as Record<ThemeBg, string | number>;
	for (const [key, value] of Object.entries(colors)) {
		if (THEME_TOKENS[key as ThemeToken].slot === "background") {
			bgColors[key as ThemeBg] = value;
		} else {
			fgColors[key as ThemeColor] = value;
		}
	}
	return { fgColors, bgColors };
}

function createTheme(themeJson: ThemeJson, mode?: TerminalColorMode, sourcePath?: string): Theme {
	const colorMode = mode ?? detectColorMode();
	const resolvedColors = withThemeTokenFallbacks(resolveThemeColors(themeJson.colors, themeJson.vars));
	const { fgColors, bgColors } = splitThemeColors(resolvedColors);
	return new Theme(fgColors, bgColors, colorMode, {
		name: themeJson.name,
		sourcePath,
		appearance: themeJson.appearance,
	});
}

let builtinTheme: Theme | undefined;

/** The built-in theme, created on first use. */
export const theme: Theme = new Proxy({} as Theme, {
	get(_target, prop) {
		builtinTheme ??= createTheme(getBuiltinThemeJson());
		const value = (builtinTheme as unknown as Record<string | symbol, unknown>)[prop];
		return typeof value === "function" ? value.bind(builtinTheme) : value;
	},
});

// ============================================================================
// HTML Export Helpers
// ============================================================================

/** The theme's colors as CSS hex strings, for the CSS custom properties of HTML exports. */
export function getResolvedThemeColors(): Record<string, string> {
	return Object.fromEntries(Object.entries(theme.colors).map(([token, color]) => [token, colorToHex(color)]));
}

/** The theme's explicit HTML export colors. */
export function getThemeExportColors(): { pageBg?: string; cardBg?: string; infoBg?: string } {
	const themeJson = getBuiltinThemeJson();
	const exportSection = themeJson.export;
	if (!exportSection) return {};
	const vars = themeJson.vars ?? {};
	// Export colors end up in CSS, which understands hex and oklch() values directly but not okhsl().
	const resolve = (value: ColorValue | undefined): string | undefined => {
		if (value === undefined) return undefined;
		const resolved = resolveVarRefs(value, vars);
		if (typeof resolved === "number") return colorToHex(indexedColor(resolved));
		if (resolved === "") return undefined;
		if (/^okhsl\(/i.test(resolved)) return colorToHex(parseColor(resolved));
		return resolved;
	};
	return {
		pageBg: resolve(exportSection.pageBg),
		cardBg: resolve(exportSection.cardBg),
		infoBg: resolve(exportSection.infoBg),
	};
}

// ============================================================================
// Syntax Highlighting
// ============================================================================

type CliHighlightTheme = Record<string, (s: string) => string>;

let cachedHighlightThemeFor: Theme | undefined;
let cachedCliHighlightTheme: CliHighlightTheme | undefined;

function buildCliHighlightTheme(t: Theme): CliHighlightTheme {
	return {
		keyword: (s: string) => t.fg("syntaxKeyword", s),
		built_in: (s: string) => t.fg("syntaxType", s),
		literal: (s: string) => t.fg("syntaxNumber", s),
		number: (s: string) => t.fg("syntaxNumber", s),
		regexp: (s: string) => t.fg("syntaxString", s),
		string: (s: string) => t.fg("syntaxString", s),
		subst: (s: string) => t.fg("text", s),
		comment: (s: string) => t.fg("syntaxComment", s),
		doctag: (s: string) => t.fg("syntaxComment", s),
		meta: (s: string) => t.fg("muted", s),
		function: (s: string) => t.fg("syntaxFunction", s),
		title: (s: string) => t.fg("syntaxFunction", s),
		class: (s: string) => t.fg("syntaxType", s),
		type: (s: string) => t.fg("syntaxType", s),
		tag: (s: string) => t.fg("syntaxPunctuation", s),
		name: (s: string) => t.fg("syntaxKeyword", s),
		attr: (s: string) => t.fg("syntaxVariable", s),
		variable: (s: string) => t.fg("syntaxVariable", s),
		params: (s: string) => t.fg("syntaxVariable", s),
		operator: (s: string) => t.fg("syntaxOperator", s),
		punctuation: (s: string) => t.fg("syntaxPunctuation", s),
		emphasis: (s: string) => t.italic(s),
		strong: (s: string) => t.bold(s),
		link: (s: string) => t.underline(s),
		addition: (s: string) => t.fg("toolDiffAdded", s),
		deletion: (s: string) => t.fg("toolDiffRemoved", s),
	};
}

function getCliHighlightTheme(t: Theme): CliHighlightTheme {
	if (cachedHighlightThemeFor !== t || !cachedCliHighlightTheme) {
		cachedHighlightThemeFor = t;
		cachedCliHighlightTheme = buildCliHighlightTheme(t);
	}
	return cachedCliHighlightTheme;
}

/**
 * Highlight code with syntax coloring based on file extension or language.
 * Returns array of highlighted lines.
 */
export function highlightCode(code: string, lang?: string): string[] {
	// Validate language before highlighting to avoid stderr spam from cli-highlight
	const validLang = lang && supportsLanguage(lang) ? lang : undefined;
	// Skip highlighting when no valid language is specified. cli-highlight's
	// auto-detection is unreliable and can misidentify prose as AppleScript,
	// LiveCodeServer, etc., coloring random English words as keywords.
	if (!validLang) {
		return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
	}
	const opts = {
		language: validLang,
		ignoreIllegals: true,
		theme: getCliHighlightTheme(theme),
	};
	try {
		return highlight(code, opts).split("\n");
	} catch {
		return code.split("\n");
	}
}

/**
 * Get language identifier from file path extension.
 */
export function getLanguageFromPath(filePath: string): string | undefined {
	const ext = filePath.split(".").pop()?.toLowerCase();
	if (!ext) return undefined;

	const extToLang: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		py: "python",
		rb: "ruby",
		rs: "rust",
		go: "go",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		h: "c",
		cpp: "cpp",
		cc: "cpp",
		cxx: "cpp",
		hpp: "cpp",
		cs: "csharp",
		php: "php",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		fish: "fish",
		ps1: "powershell",
		sql: "sql",
		html: "html",
		htm: "html",
		css: "css",
		scss: "scss",
		sass: "sass",
		less: "less",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		xml: "xml",
		md: "markdown",
		markdown: "markdown",
		dockerfile: "dockerfile",
		makefile: "makefile",
		cmake: "cmake",
		lua: "lua",
		perl: "perl",
		r: "r",
		scala: "scala",
		clj: "clojure",
		ex: "elixir",
		exs: "elixir",
		erl: "erlang",
		hs: "haskell",
		ml: "ocaml",
		vim: "vim",
		graphql: "graphql",
		proto: "protobuf",
		tf: "hcl",
		hcl: "hcl",
	};

	return extToLang[ext];
}

export interface RgbColor {
	r: number;
	g: number;
	b: number;
}
export interface TerminalColors {
	foreground?: RgbColor;
	background?: RgbColor;
	palette?: RgbColor[];
}

export function detectColorMode(trueColor?: boolean): TerminalColorMode {
	if (trueColor === true) return "truecolor";
	if (trueColor === false) return "256color";
	const override = process.env.BRIAN_TRUE_COLOR?.toLowerCase();
	if (override === "1" || override === "true" || override === "yes") return "truecolor";
	if (override === "0" || override === "false" || override === "no") return "256color";
	const colorterm = process.env.COLORTERM?.toLowerCase();
	if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
	return "256color";
}
