import debug from 'debug';
import config from './config';
import AnalysisFactory from './domain/analysisFactory';

const logger = debug('app:AnalysisMngr');

async function bootstrap(): Promise<void> {
	const jobId = config.JOB_ID;
	const jobType = config.JOB_TYPE;
	logger(`Init to validate current step from analysis: jobId=${jobId} jobType=${jobType}`);

	await new AnalysisFactory(jobId, jobType).init();

	logger(`Job ${jobId} (${jobType}) finished successfully, stopping task`);
	process.exit(0);
}

bootstrap().catch((error) => {
	logger(`Job failed: ${error instanceof Error ? error.stack : error}`);
	process.exit(1);
});
