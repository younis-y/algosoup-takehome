export const gbp = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

// Today's UK trading date as YYYY-MM-DD.
export const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
