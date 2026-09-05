import { SourceRequest } from "../source/sourceRequest.interface";

export interface GetSourceFactory {
    execute(jobId: string): Promise<any>;
    validateSource(request: SourceRequest): Promise<SourceRequest>;
}
