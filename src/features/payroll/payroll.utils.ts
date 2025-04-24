import { Employee, PayType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { parse, format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, subYears,
    startOfQuarter, endOfQuarter, subQuarters, parseISO, isValid, startOfDay, endOfDay} from 'date-fns';

/**
 * Placeholder for future payroll calculation utilities.
 * For example, calculating gross pay based on hours/salary, deductions, taxes etc.
 */

// Example: Basic gross pay calculation (highly simplified)
export const calculateGrossPay = (employee: Employee, hoursWorked?: number): Decimal => {
  if (employee.payType === PayType.SALARY && employee.salary) {
    // This needs refinement based on pay frequency (e.g., divide annual salary)
    // For simplicity, returning a fixed portion - replace with actual logic
    return employee.salary.dividedBy(26); // Assuming bi-weekly for now
  } else if (employee.payType === PayType.HOURLY && employee.payRate && hoursWorked) {
    return employee.payRate.times(hoursWorked);
  }
  return new Decimal(0);
};

// Basic Date Range Parser (Can be significantly expanded or replaced with NLP/LLM)
export interface DateRange {
    startDate: Date;
    endDate: Date;
}

// Month name map for parsing
const monthMap: { [key: string]: number } = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4, // 'may' maps to itself
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
};

/**
 * Parses common date range expressions from a query string.
 * Limited capabilities; use NLP library (e.g., chrono-node) for complex parsing.
 *
 * @param query The input query string.
 * @returns A DateRange object { startDate, endDate } or null if no known pattern matches.
 */
export function parseDateRange(query: string): DateRange | null {
    const lowerQuery = query.toLowerCase();
    const now = new Date();
    let match;

    // --- Relative Ranges ---

    if (lowerQuery.includes('last quarter')) {
        const currentQuarterStart = startOfQuarter(now);
        const lastQuarterStart = subQuarters(currentQuarterStart, 1);
        const lastQuarterEnd = endOfQuarter(lastQuarterStart);
        // Use startOfDay/endOfDay for full range inclusivity
        return { startDate: startOfDay(lastQuarterStart), endDate: endOfDay(lastQuarterEnd) };
    }

    if (lowerQuery.includes('this quarter')) {
        const currentQuarterStart = startOfQuarter(now);
        const currentQuarterEnd = endOfQuarter(now);
        return { startDate: startOfDay(currentQuarterStart), endDate: endOfDay(currentQuarterEnd) };
    }

    if (lowerQuery.includes('last month')) {
        const lastMonthStart = startOfMonth(subMonths(now, 1));
        const lastMonthEnd = endOfMonth(lastMonthStart); // Pass start date to endOfMonth
        return { startDate: startOfDay(lastMonthStart), endDate: endOfDay(lastMonthEnd) };
    }

    if (lowerQuery.includes('this month')) {
        const thisMonthStart = startOfMonth(now);
        const thisMonthEnd = endOfMonth(now);
        return { startDate: startOfDay(thisMonthStart), endDate: endOfDay(thisMonthEnd) };
    }

    if (lowerQuery.includes('last year')) {
        const lastYear = subYears(now, 1);
        const lastYearStart = startOfYear(lastYear);
        const lastYearEnd = endOfYear(lastYear);
         return { startDate: startOfDay(lastYearStart), endDate: endOfDay(lastYearEnd) };
    }

    if (lowerQuery.includes('this year')) {
        const thisYearStart = startOfYear(now);
        const thisYearEnd = endOfYear(now);
        return { startDate: startOfDay(thisYearStart), endDate: endOfDay(thisYearEnd) };
    }
    

    // --- Specific Year ---
    // Matches "in 2023", "for 2024", "year 2022" etc.
    match = lowerQuery.match(/(?:in|for|year)\s+(\d{4})/);
    if (match) {
        const year = parseInt(match[1], 10);
        // Basic validation for sensible year range
        if (year > 1900 && year < 2100) {
             try {
                const yearStartDate = startOfYear(new Date(year, 0, 1)); // Set date explicitly
                const yearEndDate = endOfYear(yearStartDate);
                if (isValid(yearStartDate) && isValid(yearEndDate)) {
                    return { startDate: startOfDay(yearStartDate), endDate: endOfDay(yearEndDate) };
                }
             } catch (e) { /* ignore invalid date construction */ }
        }
    }


    // --- Specific Month and Year ---
    // Matches "january 2024", "Feb 2025", "mar 23" (assumes current century for yy) etc.
    // Regex uses non-capturing groups (?:...) for optional parts like 'uary'
    match = lowerQuery.match(
        /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4}|\d{2})\b/
        );
    if (match) {
        const monthName = match[1];
        let yearStr = match[2];
        let year = parseInt(yearStr, 10);

        // Handle two-digit year (e.g., "mar 23" -> 2023) - adjust century logic if needed
        if (yearStr.length === 2) {
            const currentYearLastTwoDigits = now.getFullYear() % 100;
            // If yy > current yy, assume previous century; otherwise, current century.
            // E.g., if now is 2025, '23' becomes 2023, '28' becomes 1928 (adjust threshold if needed)
            year = (year <= (currentYearLastTwoDigits + 5)) ? 2000 + year : 1900 + year; // Rough heuristic
        }


        const monthIndex = monthMap[monthName];
        if (monthIndex !== undefined && year > 1900 && year < 2100) {
            try {
                 const monthStartDate = startOfMonth(new Date(year, monthIndex, 1));
                 const monthEndDate = endOfMonth(monthStartDate);
                 if (isValid(monthStartDate) && isValid(monthEndDate)) {
                     return { startDate: startOfDay(monthStartDate), endDate: endOfDay(monthEndDate) };
                 }
            } catch (e) { /* ignore invalid date construction */ }
        }
    }


    // --- Specific "between" Format (YYYY-MM-DD) ---
    // NOTE: This is VERY basic. Does not handle other date formats or natural language.
    // Recommend using a library like chrono-node for robust parsing.
    match = lowerQuery.match(/between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})/);
    if (match) {
        const dateStr1 = match[1];
        const dateStr2 = match[2];
        try {
            const date1 = parseISO(dateStr1); // Use parseISO for strict format
            const date2 = parseISO(dateStr2);

            if (isValid(date1) && isValid(date2)) {
                 // Ensure startDate is before endDate
                 const startDate = date1 < date2 ? date1 : date2;
                 const endDate = date1 < date2 ? date2 : date1;
                 return { startDate: startOfDay(startDate), endDate: endOfDay(endDate) };
            }
        } catch (e) { /* ignore invalid date parsing */ }
    }

    // Add more patterns here as needed...
    // e.g., specific date "on 2024-03-15" -> return range covering just that day

    // --- No Match Found ---
    return null;
}

// Currency Formatter
const currencyFormatter = new Intl.NumberFormat('en-US', { // Adjust locale as needed
    style: 'currency',
    currency: 'USD', // Make this dynamic based on company settings if needed
});

export function formatCurrency(value: Decimal | number | null | undefined): string {
    if (value === null || value === undefined) return 'N/A';
    const numValue = typeof value === 'number' ? value : value.toNumber();
    return currencyFormatter.format(numValue);
}

// Date Formatter
export function formatDate(date: Date | null | undefined): string {
     if (!date) return 'N/A';
     return format(date, 'yyyy-MM-dd'); // Or 'MM/dd/yyyy', 'do MMM yyyy' etc.
}

// Include PayFrequency enum and other shared types/utils if not defined elsewhere
export enum PayFrequency {
    WEEKLY = 'WEEKLY',
    BI_WEEKLY = 'BI_WEEKLY',
    SEMI_MONTHLY = 'SEMI_MONTHLY',
    MONTHLY = 'MONTHLY',
    ANNUALLY = 'ANNUALLY',
}


// Add other utility functions as needed, e.g.,
// - calculateNetPay(grossPay, deductions, taxes)
// - getPayPeriodDates(frequency, date)
// - etc.
