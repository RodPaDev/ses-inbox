import { mock } from "bun:test";

mock.module("sst", () => ({
	Resource: {
		EmailsTable: { name: "test-emails-table" },
		ApiKeysTable: { name: "test-api-keys-table" },
		EmailBucket: { name: "test-email-bucket" },
	},
}));
