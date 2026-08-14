export const metrics = {
  requestsTotal: 0,
  upstreamErrorsTotal: 0,
  bytesTotal: { upload: 0, download: 0 },
  throttleWaitSecondsTotal: 0,
  accessDeniedTotal: { ip: 0, basic: 0 },
};

export function log(
  level: string,
  eventCode: string,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      component: "traffic-gateway",
      event_code: eventCode,
      message,
      ...fields,
    }),
  );
}
