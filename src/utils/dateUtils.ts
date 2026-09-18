export function toSafeDate(value: any): Date | null {
  if (value == null) return null;

  // Already a Date
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Firestore Timestamp-like
  if (typeof value === 'object') {
    if (typeof (value as any).seconds === 'number') {
      return toSafeDate((value as any).seconds);
    }
    if (typeof (value as any)._seconds === 'number') {
      return toSafeDate((value as any)._seconds);
    }
    if (typeof (value as any).toDate === 'function') {
      try {
        const d = (value as any).toDate();
        return toSafeDate(d);
      } catch {
        return null;
      }
    }
  }

  // Number - could be seconds (10 digits) or milliseconds (13+ digits)
  if (typeof value === 'number') {
    // If looks like seconds (<= 1e12), convert to ms
    let ms = value;
    if (value > 0 && value < 1e12) ms = value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // String - try numeric first, then Date parsing
  if (typeof value === 'string') {
    const n = Number(value);
    if (!Number.isNaN(n)) return toSafeDate(n);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export default toSafeDate;
