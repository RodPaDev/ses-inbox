/// <reference path="../../../../.sst/platform/config.d.ts" />

export function createApiRouter(
  api: sst.aws.Function,
  apiDomain: string,
  hostedZoneId?: string,
) {
  return new sst.aws.Router("ApiRouter", {
    routes: {
      "/*": api.url,
    },
    domain: hostedZoneId
      ? { name: apiDomain, dns: sst.aws.dns({ zone: hostedZoneId }) }
      : { name: apiDomain },
  });
}
