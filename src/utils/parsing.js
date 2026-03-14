/**
 * Centralized number parsing for quantities.
 * Accepts both comma and dot as decimal separator (e.g. "1,5" and "1.5").
 * @param {string|number} value
 * @returns {number}
 */
export function parseDecimal(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  const str = String(value).trim().replace(',', '.')
  const num = parseFloat(str)
  return Number.isNaN(num) ? 0 : num
}

/**
 * Format quantity for Czech UI (comma as decimal separator).
 * @param {number} value
 * @returns {string}
 */
export function formatQuantity(value) {
  if (value == null || Number.isNaN(value)) return '0'
  const n = Number(value)
  return n % 1 === 0 ? String(n) : n.toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}
