import { ValidationResult } from "../validationResult.interface";

export interface ArchitectureValidationResult extends ValidationResult {
    architecturePattern: string;
    evidencePaths: string[];
}

export interface ArquitectureAnalysisFactory {
    execute(jobId: string): Promise<any>;
    validatePatterns(jobId: string): Promise<ArchitectureValidationResult>;
}
