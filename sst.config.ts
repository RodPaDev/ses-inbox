/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
	app(input) {
		return {
			name: "ses-inbox",
			home: "aws",
			providers: {
				aws: {
					profile: "personal",
				},
			},
			removal: input?.stage === "production" ? "retain" : "remove",
		};
	},
	async run() {
		$transform(sst.aws.Function, (args) => {
			args.runtime ??= "nodejs24.x";
		});
		const { createInfra } = await import("@ses-inbox/infra");
		return createInfra();
	},
});
