import httpStatus from 'http-status-codes';
// import { OpenAI } from '@langchain/openai';
import OpenAI from 'openai';
import { Decimal } from '@prisma/client/runtime/library';
import { TogetherAI } from "@langchain/community/llms/togetherai";
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PrismaClient, Payroll, PayrollStatus } from '@prisma/client';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';

import env from '../../config/env'; // Assuming env config is set up
import logger from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { parseDateRange, DateRange, formatCurrency, formatDate } from '../payroll/payroll.utils';

const prisma = new PrismaClient();

// let llm: OpenAI | null = null;
let llm: TogetherAI | null = null; // Using TogetherAI for LLM
let isLLMConfigured = false;

if (env.TOGETHER_API_KEY) {
	// try {
	// 	// Initialize OpenAI LLM with the API key and other configurations
	// 	llm = new OpenAI({
	// 		openAIApiKey: env.OPENAI_API_KEY,
	// 		temperature: env.OPENAI_TEMPERATURE ?? 0.2, // Lower temperature for more factual, less creative answers based on context
	// 		modelName: env.OPENAI_MODEL ?? 'gpt-3.5-turbo-instruct', // Or "text-davinci-003" or other suitable completion model
	// 		timeout: env.OPENAI_API_TIMEOUT ?? 15000, // Timeout in milliseconds
	// 		maxRetries: env.OPENAI_API_RETRIES ?? 2, // Number of retries on failure
	// 	});
	// 	isLLMConfigured = true;
	// } catch (error) {
	// 	logger.error(`Failed to configure OpenAI LLM: ${error}`);
	// }
    try {
        llm = new TogetherAI({
            apiKey: env.TOGETHER_API_KEY,
            modelName: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free'
        });
        isLLMConfigured = true;
        logger.info('OpenAI LLM configured successfully uisng together api.');
    } catch (error) {
        logger.error(`Failed to configure OpenAI LLM: ${error}`);
    }
} else {
	logger.warn('OPENAI_API_KEY is not set. LangchainReportService will not function.');
	isLLMConfigured = false;
}

// --- Data Fetching & Formatting ---
// Define interfaces for cleaner data handling
interface PayrollSummary {
	count: number;
	totalGross: Decimal | null;
	totalNet: Decimal | null;
}
interface StatusCount {
	status: PayrollStatus;
	count: number;
}
interface RecentPayrollInfo {
	id: string;
	periodStart: Date;
	periodEnd: Date;
	status: PayrollStatus;
	totalGross: Decimal | null;
	employeeCount: number | null;
}

/**
 * Represents the structured data fetched based on query analysis.
 */
interface FetchedContextData {
	query: string;
	dateRange?: DateRange | null; // Detected date range
	requestedData: {
		totalSummary?: PayrollSummary;
		statusCounts?: StatusCount[];
		employeeCount?: number;
		recentPayrolls?: RecentPayrollInfo[];
		// Add more fields for other intents
	};
	foundData: boolean; // Flag if any relevant data was actually found
	messages: string[]; // User-facing messages (e.g., "No data found for last month")
}

/**
 * Analyzes the query, fetches relevant data, and structures it.
 * @param query - The natural language query.
 * @param companyId - The ID of the company context.
 * @returns A promise resolving to structured context data.
 */
const fetchDataForContext = async (
	query: string,
	companyId: string
): Promise<FetchedContextData> => {
	const lowerQuery = query.toLowerCase();
	const companyFilter = { companyId: companyId };
	const dateRange = parseDateRange(lowerQuery);

	const result: FetchedContextData = {
		query: query,
		dateRange: dateRange,
		requestedData: {},
		foundData: false,
		messages: [],
	};

	const dateFilter = dateRange
		? { periodEnd: { gte: dateRange.startDate }, periodStart: { lte: dateRange.endDate } }
		: {};

    

	const wantsTotal: boolean =
		lowerQuery.includes('total') &&
		(lowerQuery.includes('payroll') ||
			lowerQuery.includes('cost') ||
			lowerQuery.includes('paid'));

	const wantsStatus: boolean = lowerQuery.includes('status') && lowerQuery.includes('payroll');

	const wantsEmployeeCount: boolean =
		lowerQuery.includes('how many') &&
		lowerQuery.includes('employee') &&
		lowerQuery.includes('number of employee') &&
		lowerQuery.includes('no of employee');

	try {
		if (wantsTotal) {
			const totalAggregateResult = await prisma.payroll.aggregate({
				_sum: {
					totalGross: true,
					totalNet: true,
				},
				_count: {
					id: true,
				},
				where: {
					...companyFilter,
					...dateFilter,
					status: PayrollStatus.PAID,
				},
			});

			if (totalAggregateResult._count.id > 0) {
				result.requestedData.totalSummary = {
					count: totalAggregateResult._count.id,
					totalGross: totalAggregateResult._sum.totalGross,
					totalNet: totalAggregateResult._sum.totalNet,
				};
				result.foundData = true;
			} else if (dateRange) {
				result.messages.push(
					`No payroll data found for the specified date range: ${formatDate(dateRange.startDate)} to ${formatDate(dateRange.endDate)}.`
				);
			}
		}

		if (wantsStatus) {
			const statusCounts = await prisma.payroll.groupBy({
				by: ['status'],
				_count: {
					id: true,
				},
				where: {
					...companyFilter,
					...dateFilter,
				},
			});

			if (statusCounts.length > 0) {
				result.requestedData.statusCounts = statusCounts.map((item) => ({
					status: item.status,
					count: item._count.id,
				}));
				result.foundData = true;
			} else if (dateRange) {
				result.messages.push(
					`No payroll status data found for the specified date range: ${formatDate(dateRange.startDate)} to ${formatDate(dateRange.endDate)}.`
				);
			}
		}

		if (wantsEmployeeCount) {
		    const employeeCount = await prisma.employee.count({
		        where: { companyId: companyId, isActive: true },
		    });

		    if (employeeCount > 0) {
		        result.requestedData.employeeCount = employeeCount;
		        result.foundData = true;
		    } else {
		        result.messages.push(`No active employees found for the specified company.`);
		    }
		}

		// --- Fallback / Default Fetch ---
		// Only fetch recent if no specific intent matched OR specific data wasn't found
		const shouldFetchRecent: boolean = !result.foundData && !wantsTotal && !wantsStatus && !wantsEmployeeCount;
		if (shouldFetchRecent) {
			logger.debug(
				{ query, companyId },
				'No specific intent matched or data found, fetching recent payrolls as fallback.'
			);
			const recentPayrolls = await prisma.payroll.findMany({
				where: { ...companyFilter },
				orderBy: { periodEnd: 'desc' },
				take: 5,
				select: {
					id: true,
					periodStart: true,
					periodEnd: true,
					status: true,
					totalGross: true,
                    employeeCount: true, // Assuming this is a field in the Payroll model
				},
			});

			if (recentPayrolls.length > 0) {
				result.requestedData.recentPayrolls = recentPayrolls.map((p) => ({
					id: p.id,
					periodStart: p.periodStart,
					periodEnd: p.periodEnd,
					status: p.status,
					totalGross: p.totalGross,
                    employeeCount: p.employeeCount, // Assuming this is a field in the Payroll model
				}));
				result.foundData = true;
			} else if (dateRange) {
				result.messages.push(
					`No recent payroll data found for the specified date range: ${formatDate(dateRange.startDate)} to ${formatDate(dateRange.endDate)}.`
				);
			}
		}
	} catch (dbError) {
		logger.error({ error: dbError, query, companyId }, 'Database error fetching context data.');
		// Don't expose detailed DB errors to the user/LLM
		throw new ApiError(
			httpStatus.INTERNAL_SERVER_ERROR,
			'Failed to retrieve necessary data from the database.'
		);
	}

	if (!result.foundData && result.messages.length === 0) {
		result.messages.push('I could not find relevant data to answer your question.');
	}

	return result;
};

/**
 * Formats the fetched structured data into a string for the LLM context.
 *
 * @param data The structured data from fetchDataForContext.
 * @returns A formatted string context.
 */
const formatContextForLLM = (data: FetchedContextData): string => {
	let contextLines: string[] = [...data.messages]; // Start with any user messages

	if (data.dateRange) {
		contextLines.push(
			`Data based on date range: ${formatDate(data.dateRange.startDate)} to ${formatDate(data.dateRange.endDate)}`
		);
	}

	if (data.requestedData.totalSummary) {
		const summary = data.requestedData.totalSummary;
		contextLines.push(`Total Payroll Summary (Paid):`);
		contextLines.push(` - Count: ${summary.count} payrolls`);
		contextLines.push(` - Total Gross Paid: ${formatCurrency(summary.totalGross)}`);
		contextLines.push(` - Total Net Paid: ${formatCurrency(summary.totalNet)}`);
	}

	if (data.requestedData.statusCounts) {
		contextLines.push(`Payroll Status Counts:`);
		data.requestedData.statusCounts.forEach((item) => {
			contextLines.push(` - ${item.status}: ${item.count}`);
		});
	}

	if (data.requestedData.employeeCount !== undefined) {
		// Check for undefined, as 0 is valid
		contextLines.push(`Active Employee Count: ${data.requestedData.employeeCount}`);
	}

	if (data.requestedData.recentPayrolls) {
		contextLines.push('Recent Payroll Runs:');
		data.requestedData.recentPayrolls.forEach((p) => {
			contextLines.push(
				` - ID: ${p.id}, Period: ${formatDate(p.periodStart)}-${formatDate(p.periodEnd)}, Status: ${p.status}, Gross: ${formatCurrency(p.totalGross)}}`
			);
		});
	}

	if (contextLines.length === 0) {
		return 'No specific data points were found or requested based on the query.'; // Fallback context
	}

	// Add context separator for clarity
	contextLines.unshift('--- Data Context Start ---');
	contextLines.push('--- Data Context End ---');

	return contextLines.join('\n');
};

// --- Prompt Template ---
// Explicitly instructs the LLM to use *only* the provided context.
const promptTemplate = PromptTemplate.fromTemplate(
	`You are a secure, sandboxed AI assistant analyzing HR and Payroll data for a company.
Your task is to answer the user's question based *exclusively* on the information presented in the 'Data Context' section below.
Do not use any external knowledge, calculations, or assumptions.
If the context does not contain the necessary information to answer the question accurately, state clearly: "I cannot answer the question based on the provided data." or explain what data is missing if evident from the context messages.
Be concise and directly address the user's question using only the facts from the context. Do **not** include explanations, chain‑of‑thought reasoning, or any other form of elaboration.
Currency values ($) and dates (YYYY-MM-DD) are already formatted correctly in the context. Present them as they appear.

<DATA_CONTEXT>  
{context}  
<END_DATA_CONTEXT>

User Question: {question}

Answer:`
);

// --- LangchainReportService ---

class LangchainReportService {
	private chain: RunnableSequence | null = null;

	constructor() {
		if (isLLMConfigured && llm) {
			// Define the chain structure
			this.chain = RunnableSequence.from([
				{
					// RunnablePassthrough allows passing the original question alongside the context
					question: new RunnablePassthrough(), // Will be the original query
					context: new RunnablePassthrough(), // Context will be passed in invoke
				},
				promptTemplate,
				llm,
				new StringOutputParser(),
			]);
			logger.info('Langchain RunnableSequence initialized.');
		} else {
			logger.warn(
				'LangchainReportService initialized but LLM chain is not available due to configuration issues.'
			);
		}
	}

	/**
	 * Generates an AI-powered report/insight based on a natural language query.
	 * Fetches aggregated data, formats it as context, and queries the LLM.
	 *
	 * @param query - The natural language question (e.g., "What was the total payroll cost last month?").
	 * @param companyId - The ID of the company to scope the data fetch.
	 * @returns A promise resolving to the AI-generated answer string.
	 * @throws {ApiError} For configuration, database, or LLM API errors.
	 */
	async generateReport(query: string, companyId: string): Promise<string> {
		const startTime = Date.now();
		logger.debug({ query, companyId }, 'Generating LangChain report...');

		if (!this.chain) {
			logger.warn('generateReport called but AI Service is not configured.');

			throw new ApiError(
				httpStatus.SERVICE_UNAVAILABLE,
				'AI reporting service is currently unavailable or not configured.'
			);
		}

		try {
			// 1. Fetch and structure relevant data
			const fetchedData = await fetchDataForContext(query, companyId);

			// If no data was found *at all* and no specific messages generated, return generic message.
			if (!fetchedData.foundData && fetchedData.messages.length === 0) {
				logger.info({ query, companyId }, 'No relevant data found for the query.');
				return 'I could not find relevant data in the database to answer your question.';
			}

			// 2. Format the data into context string for the LLM
			const context = formatContextForLLM(fetchedData);
			logger.debug(
				{ contextLength: context.length, companyId },
				'Formatted context for LLM.'
			);

			// Basic context length check (adjust limit based on model)
			const MAX_CONTEXT_LENGTH = 4000; // Example limit, depends on model token limit
			if (context.length > MAX_CONTEXT_LENGTH) {
				logger.warn(
					{ contextLength: context.length, limit: MAX_CONTEXT_LENGTH },
					'Generated context exceeds length limit. Truncating.'
				);
				// Simple truncation - smarter strategies might be needed
				const truncatedContext =
					context.substring(0, MAX_CONTEXT_LENGTH) + '\n... (Context Truncated)';
				// TODO: Implement smarter truncation or summarization if this happens often.
				throw new ApiError(
					httpStatus.INTERNAL_SERVER_ERROR,
					'Could not process the request as the relevant data is too large.'
				);
			}

			// 3. Invoke the LangChain Sequence
			logger.debug('Invoking LLM chain...');
			const rawResult  = await this.chain.invoke({ question: query, context: context });
            let processedResult = rawResult;
            const startThinkTag = '<think>';
            const endThinkTag = '</think>';
            const startIndex = rawResult.indexOf(startThinkTag);
            const endIndex = rawResult.lastIndexOf(endThinkTag);

            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                // Extract the part *after* the last </think> tag
                // This assumes the final answer is always after the last think block
                processedResult = rawResult.substring(endIndex + endThinkTag.length);
            } else if (startIndex !== -1 && endIndex === -1) {
                // Case where only the start tag is present (less likely but good to handle)
                 processedResult = rawResult.substring(startIndex + startThinkTag.length);
            }

            processedResult = processedResult.trim()
			const duration = Date.now() - startTime;
			logger.info(
				{ query, companyId, durationMs: duration },
				'Successfully generated LangChain report.'
			);

			console.log('LLM Response:', processedResult);
			return processedResult;
		} catch (error: any) {
			const duration = Date.now() - startTime;
			logger.error(
				{ error, query, companyId, durationMs: duration },
				'Error generating LangChain report.'
			);

			// Handle specific error types
			if (error instanceof ApiError) {
				throw error; // Re-throw known operational errors
			} else if (error.response?.status === 401) {
				// OpenAI Auth Error
				throw new ApiError(
					httpStatus.INTERNAL_SERVER_ERROR,
					'AI Service authentication failed. Check API Key configuration.'
				);
			} else if (error.response?.status === 429) {
				// OpenAI Rate Limit Error
				throw new ApiError(
					httpStatus.TOO_MANY_REQUESTS,
					'AI Service is currently experiencing high load. Please try again later.'
				);
			} else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
				// Network Timeout
				throw new ApiError(
					httpStatus.GATEWAY_TIMEOUT,
					'AI Service request timed out. Please try again later.'
				);
			}

			// Generic fallback error
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				`Failed to generate AI report: ${error.message || 'An unknown error occurred'}`
			);
		}
	}
}

export const langchainReportService = new LangchainReportService();
