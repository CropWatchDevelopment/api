export const getTimeZoneName = (timeZone: string, date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-EN', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const tzNameResult =
    parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  return tzNameResult;
};
