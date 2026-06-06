export function formatPrice(p: number, lang: 'fr' | 'en' = 'en'): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  }).format(p);
}

export function formatSlot(iso: string, lang: 'fr' | 'en' = 'fr'): string {
  return new Date(iso).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris'
  });
}
