import { createContext, useContext, type ReactNode } from "react";
import { useGetSettings } from "@workspace/api-client-react";

export const DEFAULT_ACCOUNT_CURRENCY = "GBP";

type CurrencyContextValue = {
  currency: string;
  formatMoney: (value: number | null | undefined) => string;
};

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: DEFAULT_ACCOUNT_CURRENCY,
  formatMoney: value => formatMoney(value, DEFAULT_ACCOUNT_CURRENCY),
});

function normalizeCurrency(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_ACCOUNT_CURRENCY;
}

export function formatMoney(value: number | null | undefined, currency = DEFAULT_ACCOUNT_CURRENCY) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const safeCurrency = normalizeCurrency(currency);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: safeCurrency,
    currencyDisplay: "symbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const settings = useGetSettings();
  const currency = normalizeCurrency(settings.data?.baseCurrency);
  return <CurrencyContext.Provider value={{ currency, formatMoney: value => formatMoney(value, currency) }}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return useContext(CurrencyContext);
}