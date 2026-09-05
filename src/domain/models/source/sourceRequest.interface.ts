import { SourceType } from "./sourceType.enum";

export interface SourceRequest {
    jobId: string;
    url: string;
    type: SourceType;
}
