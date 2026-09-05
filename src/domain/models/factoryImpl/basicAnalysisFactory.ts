import { ValidationResult } from "../validationResult.interface";

export { ValidationResult };

export interface LanguageValidationResult extends ValidationResult {
    detectedLanguage: string;
}

export interface FrameworkValidationResult extends ValidationResult {
    detectedFramework: string;
}

export interface ContentValidationResult extends ValidationResult {
    fileCount: number;
    folderCount: number;
}

export interface BasicAnalysisFactory {
    execute(jobId: string): Promise<any>;
    validateName(jobId: string): Promise<ValidationResult>;
    validateLanguage(jobId: string): Promise<LanguageValidationResult>;
    validateFrameWork(jobId: string): Promise<FrameworkValidationResult>;
    ValidateContent(jobId: string): Promise<ContentValidationResult>;
}