export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.BRIAN_EXPERIMENTAL === "1";
}
