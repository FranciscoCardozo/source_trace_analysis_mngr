export class SourceValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SourceValidationError";
    }
}
