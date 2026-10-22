// Reads a birthday typed by a person. No imports, so it is easy to test.
//
// Understands (year is optional):
//   March 3, 2002   march 3   mar 3rd   3 march 2002
//   3/15   3/15/2002   03-15   15/3 (swapped when the first number is above 12)
//
// Returns { month, day, year } (year may be null) or null if it could not be read.

const MONTHS = {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sept: 9, sep: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
};

export function parseBirthdayDate(text, now = new Date()) {
    const clean = String(text || '')
        .toLowerCase()
        .replace(/,/g, ' ')
        .replace(/(\d+)(st|nd|rd|th)\b/g, '$1')
        .trim();

    const tokens = clean.split(/[\s/\-.]+/).filter(Boolean);

    if (tokens.length < 2 || tokens.length > 3) return null;

    const isNumber = (value) => /^\d+$/.test(value);

    let month;
    let day;
    let yearText = tokens[2] ?? null;

    if (MONTHS[tokens[0]] && isNumber(tokens[1])) {
        // March 3 [2002]
        month = MONTHS[tokens[0]];
        day = Number(tokens[1]);
    } else if (MONTHS[tokens[1]] && isNumber(tokens[0])) {
        // 3 March [2002]
        month = MONTHS[tokens[1]];
        day = Number(tokens[0]);
    } else if (isNumber(tokens[0]) && isNumber(tokens[1])) {
        // 3/15 [2002]
        month = Number(tokens[0]);
        day = Number(tokens[1]);

        if (month > 12 && day <= 12) [month, day] = [day, month];
    } else {
        return null;
    }

    let year = null;

    if (yearText !== null) {
        if (!/^\d{4}$/.test(yearText)) return null;

        year = Number(yearText);

        if (year < 1900 || year > now.getFullYear()) return null;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    return { month, day, year };
}
