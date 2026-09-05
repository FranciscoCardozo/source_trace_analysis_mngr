export interface FunctionalResumeFactory {
    execute(jobId: string): Promise<any>;
    getFunctionalResume(jobId: string): Promise<string>;
}