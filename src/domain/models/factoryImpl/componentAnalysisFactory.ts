import { ValidationResult } from "../validationResult.interface";

export interface ControllerValidationResult extends ValidationResult {
    controllers: string[];
}

export interface ServiceValidationResult extends ValidationResult {
    services: string[];
}

export interface ModelValidationResult extends ValidationResult {
    models: string[];
}

export interface FrameworkComponentValidationResult extends ValidationResult {
    components: string[];
}

export interface ApiValidationResult extends ValidationResult {
    apis: string[];
    evidencePaths: string[];
}

export interface ComponentAnalysisFactory {
    execute(jobId: string): Promise<any>;
    validateControllers(jobId: string): Promise<ControllerValidationResult>;
    validateServices(jobId: string): Promise<ServiceValidationResult>;
    validateModels(jobId: string): Promise<ModelValidationResult>;
    validateComponents(jobId: string, framework: string): Promise<FrameworkComponentValidationResult>;
    validateApis(jobId: string): Promise<ApiValidationResult>;
}
