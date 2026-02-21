// ActorSchemaManager.mjs
import fs from 'fs';
import { join } from 'path';

/**
 * ActorSchemaManager - Generates Apify actor schema files from a unified YAML config
 * 
 * Generates:
 *   - .actor/actor.json
 *   - .actor/input_schema.json
 *   - .actor/dataset_schema.json
 *   - .actor/output_schema.json
 *   - ./INPUT.json (optional)
 */
class ActorSchemaManager {
    /**
     * @param {object} config - The schemas section from websy-spec.yml
     * @param {object} options - Additional options
     * @param {string} options.basePath - Base path for file generation (default: process.cwd())
     * @param {boolean} options.dryRun - If true, return schemas without writing files
     * @param {boolean} options.verbose - If true, log detailed output
     */
    constructor(config, options = {}) {
        this.config = config;
        this.basePath = options.basePath || process.cwd();
        this.dryRun = options.dryRun || false;
        this.verbose = options.verbose || false;
        
        this.actorDir = join(this.basePath, '.actor');
    }

    /**
     * Convert snake_case to Title Case
     * @param {string} str - snake_case string
     * @returns {string} - Title Case string
     */
    static toTitleCase(str) {
        return str
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    /**
     * Infer field format from field name and config
     * @param {string} fieldName - The field name
     * @param {object} fieldConfig - The field configuration
     * @returns {string} - The inferred format
     */
    static inferFormat(fieldName, fieldConfig) {
        if (fieldConfig.format) return fieldConfig.format;
        if (fieldConfig.array) return 'array';
        if (fieldName.endsWith('_url') || fieldName === 'website') return 'link';
        if (fieldName.endsWith('_links')) return 'array';
        return 'text';
    }

    /**
     * Infer field type from field config
     * @param {object} fieldConfig - The field configuration
     * @returns {string} - The JSON schema type
     */
    static inferType(fieldConfig) {
        if (fieldConfig.type) return fieldConfig.type;
        if (fieldConfig.array) return 'array';
        return 'string';
    }

    /**
     * Infer editor type for input fields
     * @param {object} fieldConfig - The field configuration
     * @returns {string} - The editor type
     */
    static inferEditor(fieldConfig) {
        if (fieldConfig.editor) return fieldConfig.editor;
        const type = fieldConfig.type || 'string';
        switch (type) {
            case 'integer':
            case 'number':
                return 'number';
            case 'boolean':
                return 'checkbox';
            case 'array':
                return 'stringList';
            default:
                return 'textfield';
        }
    }

    /**
     * Get all dataset fields including those from field_groups
     * @returns {object} - Combined fields object
     */
    getAllDatasetFields() {
        const dataset = this.config.dataset || {};
        const fields = { ...(dataset.fields || {}) };
        
        // Add fields from all field_groups (they're optional but always present in schema)
        const fieldGroups = dataset.field_groups || {};
        for (const groupName of Object.keys(fieldGroups)) {
            const groupFields = fieldGroups[groupName];
            for (const [fieldName, fieldConfig] of Object.entries(groupFields)) {
                fields[fieldName] = {
                    ...fieldConfig,
                    _fromGroup: groupName  // Track origin for optional marking
                };
            }
        }
        
        return fields;
    }

    /**
     * Build input field to field_group mapping
     * @returns {Map} - Map of input field names to group names
     */
    getInputGroupMapping() {
        const mapping = new Map();
        const inputFields = this.config.input?.fields || {};
        
        for (const [fieldName, fieldConfig] of Object.entries(inputFields)) {
            if (fieldConfig.group) {
                mapping.set(fieldName, fieldConfig.group);
            }
        }
        
        return mapping;
    }

    /**
     * Generate .actor/actor.json
     * @returns {object} - The actor.json content
     */
    generateActorJson() {
        const actorConfig = this.config.actor || {};
        
        return {
            actorSpecification: 1,
            name: actorConfig.name || 'unnamed-actor',
            version: actorConfig.version || '0.1',
            buildTag: actorConfig.build_tag || 'latest',
            environmentVariables: actorConfig.environment_variables || {},
            input: './input_schema.json',
            output: './output_schema.json',
            storages: {
                dataset: './dataset_schema.json'
            }
        };
    }

    /**
     * Generate .actor/input_schema.json
     * @returns {object} - The input_schema.json content
     */
    generateInputSchema() {
        const inputConfig = this.config.input || {};
        const actorConfig = this.config.actor || {};
        
        const properties = {};
        const customFields = inputConfig.fields || {};

        for (const [fieldName, fieldConfig] of Object.entries(customFields)) {
            const field = {
                title: fieldConfig.title || ActorSchemaManager.toTitleCase(fieldName),
                type: fieldConfig.type || 'string',
                description: fieldConfig.description || fieldConfig.desc || '',
                editor: ActorSchemaManager.inferEditor(fieldConfig)
            };

            if (fieldConfig.sectionCaption !== undefined) {
                field.sectionCaption = fieldConfig.sectionCaption;
            }
            
            if (fieldConfig.prefill !== undefined) field.prefill = fieldConfig.prefill;
            if (fieldConfig.default !== undefined) field.default = fieldConfig.default;
            if (fieldConfig.minLength !== undefined) field.minLength = fieldConfig.minLength;
            if (fieldConfig.maxLength !== undefined) field.maxLength = fieldConfig.maxLength;
            if (fieldConfig.minimum !== undefined) field.minimum = fieldConfig.minimum;
            if (fieldConfig.maximum !== undefined) field.maximum = fieldConfig.maximum;
            if (fieldConfig.enum !== undefined) field.enum = fieldConfig.enum;
            
            properties[fieldName] = field;
        }
        
        return {
            title: actorConfig.title || ActorSchemaManager.toTitleCase(actorConfig.name || 'Actor Input'),
            type: 'object',
            schemaVersion: 1,
            properties,
            required: inputConfig.required || []
        };
    }

    /**
     * Generate .actor/dataset_schema.json
     * @returns {object} - The dataset_schema.json content
     */
    generateDatasetSchema() {
        const allFields = this.getAllDatasetFields();
        const dataset = this.config.dataset || {};
        const views = dataset.views || {};
        
        // Build fields schema
        const fieldsProperties = {};
        for (const [fieldName, fieldConfig] of Object.entries(allFields)) {
            const fieldType = ActorSchemaManager.inferType(fieldConfig);
                const field = {
                    type: fieldConfig.nullable === false ? fieldType : [fieldType, 'null'],
                    title: fieldConfig.title || ActorSchemaManager.toTitleCase(fieldName),
                    description: fieldConfig.description || fieldConfig.desc || ''
                };
            
            // Handle array types
            if (fieldType === 'array') {
                field.items = { type: fieldConfig.itemType || 'string' };
            }
            
            fieldsProperties[fieldName] = field;
        }
        
        // Build views
        const viewsOutput = {};
        for (const [viewName, viewConfig] of Object.entries(views)) {
            const viewFields = viewConfig.fields || [];
            const displayProperties = {};
            
            for (const fieldName of viewFields) {
                const fieldConfig = allFields[fieldName];
                if (!fieldConfig) {
                    if (this.verbose) {
                        console.warn(`Warning: Field '${fieldName}' in view '${viewName}' not found in fields definition`);
                    }
                    continue;
                }
                
                displayProperties[fieldName] = {
                    label: fieldConfig.label || fieldConfig.title || ActorSchemaManager.toTitleCase(fieldName),
                    format: ActorSchemaManager.inferFormat(fieldName, fieldConfig)
                };
            }
            
            viewsOutput[viewName] = {
                title: viewConfig.title || ActorSchemaManager.toTitleCase(viewName),
                transformation: {
                    fields: viewFields
                },
                display: {
                    component: viewConfig.component || 'table',
                    properties: displayProperties
                }
            };
        }
        
        return {
            actorSpecification: 1,
            fields: {
                $schema: 'http://json-schema.org/draft-07/schema#',
                type: 'object',
                properties: fieldsProperties
                // Note: We don't add 'required' - all fields from field_groups are optional
            },
            views: viewsOutput
        };
    }

    /**
     * Generate .actor/output_schema.json
     * @returns {object} - The output_schema.json content
     */
    generateOutputSchema() {
        const outputConfig = this.config.output || {};
        
        return {
            actorOutputSchemaVersion: 1,
            title: outputConfig.title || 'Scraper Results',
            description: outputConfig.description || 'Scraper Results',
            properties: outputConfig.properties || {
                results: {
                    type: 'string',
                    title: 'Results',
                    template: '{{links.apiDefaultDatasetUrl}}/items'
                }
            }
        };
    }

    /**
     * Generate ./INPUT.json with default values
     * @returns {object} - The INPUT.json content
     */
    generateDefaultInput() {
        const inputConfig = this.config.input || {};
        const defaults = {};
        const customFields = inputConfig.fields || {};
        for (const [fieldName, fieldConfig] of Object.entries(customFields)) {
            if (fieldConfig.default !== undefined) {
                defaults[fieldName] = fieldConfig.default;
            } else if (fieldConfig.prefill !== undefined) {
                defaults[fieldName] = fieldConfig.prefill;
            } else if (fieldConfig.type === 'boolean') {
                defaults[fieldName] = false;
            } else if (fieldConfig.type === 'integer' || fieldConfig.type === 'number') {
                defaults[fieldName] = 0;
            } else if (fieldConfig.type === 'array') {
                defaults[fieldName] = [];
            }
        }
        
        // Override with explicit defaults if provided
        if (inputConfig.defaults) {
            Object.assign(defaults, inputConfig.defaults);
        }
        
        return defaults;
    }

    /**
     * Ensure .actor directory exists
     */
    ensureActorDir() {
        if (!fs.existsSync(this.actorDir)) {
            fs.mkdirSync(this.actorDir, { recursive: true });
            if (this.verbose) console.log(`Created directory: ${this.actorDir}`);
        }
    }

    /**
     * Write JSON file with pretty formatting
     * @param {string} filePath - Path to write to
     * @param {object} content - Content to write
     */
    writeJsonFile(filePath, content) {
        const json = JSON.stringify(content, null, 2);
        fs.writeFileSync(filePath, json + '\n', 'utf8');
        if (this.verbose) console.log(`Written: ${filePath}`);
    }

    /**
     * Generate all actor schema files
     * @returns {object} - Object containing all generated schemas
     */
    generateAllSchemas() {
        const schemas = {
            actor: this.generateActorJson(),
            inputSchema: this.generateInputSchema(),
            datasetSchema: this.generateDatasetSchema(),
            outputSchema: this.generateOutputSchema()
        };
        
        if (!this.dryRun) {
            this.ensureActorDir();
            this.writeJsonFile(join(this.actorDir, 'actor.json'), schemas.actor);
            this.writeJsonFile(join(this.actorDir, 'input_schema.json'), schemas.inputSchema);
            this.writeJsonFile(join(this.actorDir, 'dataset_schema.json'), schemas.datasetSchema);
            this.writeJsonFile(join(this.actorDir, 'output_schema.json'), schemas.outputSchema);
            console.log('✅ Generated all actor schemas in .actor/');
        }
        
        return schemas;
    }

    /**
     * Generate INPUT.json file with defaults
     * @param {string} outputPath - Optional custom output path
     * @returns {object} - The generated defaults
     */
    generateInputFile(outputPath = null) {
        const defaults = this.generateDefaultInput();
        const targetPath = outputPath || join(this.basePath, 'INPUT.json');
        
        if (!this.dryRun) {
            this.writeJsonFile(targetPath, defaults);
            console.log(`✅ Generated default input file: ${targetPath}`);
        }
        
        return defaults;
    }

    /**
     * Validate the config structure
     * @returns {object} - Validation result { valid: boolean, errors: string[] }
     */
    validate() {
        const errors = [];
        
        if (!this.config) {
            errors.push('Config is empty or undefined');
            return { valid: false, errors };
        }
        
        // Check actor config
        if (!this.config.actor?.name) {
            errors.push('Missing required field: schemas.actor.name');
        }
        
        // Check dataset views reference valid fields
        const allFields = this.getAllDatasetFields();
        const views = this.config.dataset?.views || {};
        for (const [viewName, viewConfig] of Object.entries(views)) {
            for (const fieldName of (viewConfig.fields || [])) {
                if (!allFields[fieldName]) {
                    errors.push(`View '${viewName}' references unknown field '${fieldName}'`);
                }
            }
        }
        
        // Check field_group references in input fields
        const fieldGroups = this.config.dataset?.field_groups || {};
        const inputFields = this.config.input?.fields || {};
        for (const [fieldName, fieldConfig] of Object.entries(inputFields)) {
            if (fieldConfig.group && !fieldGroups[fieldConfig.group]) {
                errors.push(`Input field '${fieldName}' references unknown field_group '${fieldConfig.group}'`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
}

export { ActorSchemaManager };
