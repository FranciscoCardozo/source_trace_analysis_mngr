export default {
    apiPath: process.env.API_PATH || '/AssessmentsMngr',
    DEBUG: process.env.DEBUG || 'assessments:*',
    DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || 'custom_table',
    JOB_ID: process.env.JOB_ID || 'jobId',
    JOB_TYPE: process.env.JOB_TYPE || 'jobType',
    SOURCE_KEY: process.env.SOURCE_KEY || 'sourceKey',
    SOURCE_URL: process.env.SOURCE_URL || '',
    SOURCE_TYPE: process.env.SOURCE_TYPE || '',
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    WORKDIR: process.env.WORKDIR || '/tmp/source-trace',
    MODEL_SERVICE_URL: process.env.MODEL_SERVICE_URL || '',
}