#!/usr/bin/env node
// Websy.mjs
import got from 'got';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { Command } from 'commander';
import yaml from 'js-yaml';

import { ActorSchemaManager } from './ActorSchemaManager.mjs';

// Valid categories that can be set for an actor
//  Updated 251217 - import { ACTOR_CATEGORIES } from '@apify/consts';
const VALID_CATEGORIES = [
    'AI', 'AGENTS', 'AUTOMATION', 'BUSINESS', 'COVID_19', 'DEVELOPER_EXAMPLES', 'DEVELOPER_TOOLS', 'ECOMMERCE',
    'FOR_CREATORS', 'GAMES', 'JOBS', 'LEAD_GENERATION', 'MARKETING', 'NEWS', 'SEO_TOOLS', 'SOCIAL_MEDIA',
    'TRAVEL', 'VIDEOS', 'REAL_ESTATE', 'SPORTS', 'EDUCATION', 'INTEGRATIONS', 'OTHER', 'OPEN_SOURCE', 'MCP_SERVERS'
];

// Actor Manager interface - provides tools to simplify deployment over the standard apify commands
class Websy {
    constructor({ apiToken, baseUrl } = {}) {
        this.apiToken = apiToken || process.env.APIFY_TOKEN;
        this.baseUrl = baseUrl || 'https://api.apify.com/v2';
        if (!this.apiToken) {
            console.error('APIFY_TOKEN environment variable is required.');
            process.exit(1);
        }
        this.client = got.extend({
            prefixUrl: this.baseUrl,
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json'
            },
            responseType: 'json'
        });
    }

    /**
     * Get actor ID either from provided value or by inspecting the .actor/actor.json file
     * @param {string} providedId - Optionally provided actor ID
     * @param {string} [prefix] - Prefix to use when constructing ID from name (defaults to APIFY_USERNAME env var)
     * @returns {string|null} - The resolved actor ID or null if it couldn't be determined
     */
    static resolveActorId(providedId, prefix = process.env.APIFY_USERNAME) {
        if (providedId) return providedId;

        try {
            const actorJsonPath = join(process.cwd(), '.actor', 'actor.json');
            if (fs.existsSync(actorJsonPath)) {
                const actorJson = JSON.parse(fs.readFileSync(actorJsonPath, 'utf8'));
                const actorName = actorJson.name;
                if (actorName) {
                    const derivedId = `${prefix}~${actorName}`;
                    console.log(`Using actor ID: ${derivedId} (derived from actor name in .actor/actor.json)`);
                    return derivedId;
                }
            }
        } catch (error) {
            console.error('Error reading actor.json:', error.message);
        }

        return null;
    }

    /**
     * Validate the categories provided
     * @param {string[]} categories - Array of categories to validate
     * @returns {object} - Object with validation result
     */
    static validateCategories(categories) {
        if (!Array.isArray(categories)) {
            return { valid: false, message: 'Categories must be an array of strings' };
        }

        if (categories.length > 3) {
            return { valid: false, message: 'Maximum of 3 categories allowed' };
        }

        const invalidCategories = categories.filter(cat => !VALID_CATEGORIES.includes(cat));
        if (invalidCategories.length > 0) {
            return {
                valid: false,
                message: `Invalid categories: ${invalidCategories.join(', ')}. Valid categories are: ${VALID_CATEGORIES.join(', ')}`
            };
        }

        return { valid: true };
    }

    static loadSpec(specPath) {
        if (!specPath) {
            console.error('Spec file path is required.');
            // process.exit(1); // let caller decide
        }

        try {
            const content = fs.readFileSync(specPath, 'utf8');
            return yaml.load(content);
        } catch (e) {
            console.error('Failed to read or parse spec file:', e.message);
            // process.exit(1); // let caller decide
            throw e;
        }
    }

    /**
     * Try to load spec file, returning null if not found
     * @param {string} specPath - Path to spec file
     * @returns {object|null} - Parsed YAML or null
     */
    static tryLoadSpec(specPath) {
        try {
            if (!fs.existsSync(specPath)) {
                return null;
            }
            const content = fs.readFileSync(specPath, 'utf8');
            return yaml.load(content);
        } catch (e) {
            return null;
        }
    }

    /**
     * Check if actor has an icon set
     * @param {object} actorData - The actor data from API
     * @returns {boolean} - True if icon is set
     */
    static hasIcon(actorData) {
        // Check pictureUrl or customData.icon
        if (actorData.pictureUrl && actorData.pictureUrl.length > 0) {
            return true;
        }
        if (actorData.customData && actorData.customData.icon) {
            return true;
        }
        return false;
    }

    /**
     * Compare local spec with online actor data and return diffs
     * @param {object} localSpec - The local websy-spec.yml data
     * @param {object} onlineData - The online actor data from API
     * @returns {object[]} - Array of diff objects { field, local, online }
     */
    static compareSpecWithOnline(localSpec, onlineData) {
        const diffs = [];
        
        if (!localSpec || !localSpec.actor_details) {
            return diffs;
        }

        const local = localSpec.actor_details;
        const online = onlineData;

        // Fields to compare
        const fieldMappings = [
            { specKey: 'title', apiKey: 'title' },
            { specKey: 'description', apiKey: 'description' },
            { specKey: 'seoTitle', apiKey: 'seoTitle' },
            { specKey: 'seoDescription', apiKey: 'seoDescription' },
            { specKey: 'isPublic', apiKey: 'isPublic' },
            { specKey: 'isDeprecated', apiKey: 'isDeprecated' },
            { specKey: 'notice', apiKey: 'notice' },
        ];

        for (const mapping of fieldMappings) {
            if (local[mapping.specKey] !== undefined) {
                const localVal = local[mapping.specKey];
                const onlineVal = online[mapping.apiKey];
                
                if (localVal !== onlineVal) {
                    diffs.push({
                        field: mapping.specKey,
                        local: localVal,
                        online: onlineVal
                    });
                }
            }
        }

        // Compare categories (array comparison)
        if (local.categories !== undefined) {
            const localCats = (local.categories || []).sort();
            const onlineCats = (online.categories || []).sort();
            
            if (JSON.stringify(localCats) !== JSON.stringify(onlineCats)) {
                diffs.push({
                    field: 'categories',
                    local: localCats,
                    online: onlineCats
                });
            }
        }

        // Compare defaultRunOptions
        if (local.defaultRunOptions !== undefined) {
            const localOpts = local.defaultRunOptions || {};
            const onlineOpts = online.defaultRunOptions || {};
            
            if (JSON.stringify(localOpts) !== JSON.stringify(onlineOpts)) {
                diffs.push({
                    field: 'defaultRunOptions',
                    local: localOpts,
                    online: onlineOpts
                });
            }
        }

        return diffs;
    }

    /**
     * Format duration in human readable form
     * @param {number} ms - Duration in milliseconds
     * @returns {string} - Formatted duration
     */
    static formatDuration(ms) {
        if (ms === null || ms === undefined) return 'N/A';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    /**
     * Format a date as Month Year (e.g., "Jan 2024", "Dec 2025")
     * @param {Date} date - The date to format
     * @returns {string} - Formatted date
     */
    static formatMonthYear(date) {
        if (!date || isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    async updateActor(actorId, updates) {
        try {
            const response = await this.client.put(`acts/${actorId}`, {
                json: updates
            });

            console.log(`Actor ${actorId} updated successfully!`);
            return response.body;
        } catch (error) {
            console.error('Error updating actor:', error.response?.body || error.message);
            throw error;
        }
    }

    async updateActorIcon(actorId, iconPath) {
        if (!fs.existsSync(iconPath)) {
            console.error(`Icon file not found: ${iconPath}`);
            return null;
        }

        try {
            // Convert image to base64
            const imageBuffer = fs.readFileSync(iconPath);
            const base64Image = imageBuffer.toString('base64');

            // Make the API call to update the icon
            const response = await this.client.put(`acts/${actorId}`, {
                json: {
                    customData: {
                        icon: base64Image
                    }
                }
            });

            console.log(`Actor ${actorId} icon updated successfully!`);
            return response.body;
        } catch (error) {
            console.error('Error updating actor icon:', error.response?.body || error.message);
            throw error;
        }
    }

    async getActor(actorId) {
        try {
            const response = await this.client.get(`acts/${actorId}`);
            return response.body;
        } catch (error) {
            console.error('Error getting actor details:', error.response?.body || error.message);
            throw error;
        }
    }

    /**
     * Get actor stats and metrics from the store/public API
     * @param {string} actorId - The actor ID (can be username~actorname format)
     * @returns {object|null} - Actor stats or null if unavailable
     */
    async getActorStats(actorId) {
        try {
            // Try to get stats from the store API which has more detailed metrics
            const response = await got.get(`https://api.apify.com/v2/acts/${actorId}?token=${this.apiToken}`, {
                responseType: 'json'
            });
            return response.body?.data?.stats || null;
        } catch (error) {
            // Stats might not be available for all actors
            return null;
        }
    }

    /**
     * Get actor public metrics from Apify Store
     * @param {string} actorId - The actor ID
     * @returns {object|null} - Public metrics or null
     */
    async getActorPublicMetrics(actorId) {
        try {
            // Extract username and actor name
            let username, actorName;
            if (actorId.includes('~')) {
                [username, actorName] = actorId.split('~');
            } else if (actorId.includes('/')) {
                [username, actorName] = actorId.split('/');
            } else {
                return null;
            }

            // Try the store endpoint for public actor data
            const response = await got.get(`https://api.apify.com/v2/store/${username}/${actorName}`, {
                responseType: 'json'
            });
            return response.body?.data || null;
        } catch (error) {
            // Public metrics might not be available
            return null;
        }
    }

    /**
     * Get actor issues metrics
     * @param {string} actorId - The actor ID (internal ID, not username~name)
     * @returns {object|null} - Issues metrics or null
     */
    async getActorIssuesMetrics(actorId) {
        try {
            const cleanActorId = actorId.includes('~') ? actorId.split('~')[1] : actorId;
            const response = await got.get(`https://console-backend.apify.com/actors/${cleanActorId}/issues/metrics`, {
                responseType: 'json',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
            return response.body || null;
        } catch (error) {
            return null;
        }
    }

    async listActors(offset = 0, limit = 20) {
        try {
            const response = await this.client.get(`acts?offset=${offset}&limit=${limit}`);
            return response.body;
        } catch (error) {
            console.error('Error listing actors:', error.response?.body || error.message);
            throw error;
        }
    }

    async buildFromSource(actorId, tarballUrl) {
        try {
            const response = await this.client.post(`acts/${actorId}/builds`, {
                json: {
                    tarballUrl,
                    useCache: true
                }
            });
            console.log(`Build for actor ${actorId} has been started`);
            return response.body;
        } catch (error) {
            console.error('Error starting build:', error.response?.body || error.message);
            throw error;
        }
    }

    async runActor(actorId, input = {}, options = {}) {
        try {
            const response = await this.client.post(`acts/${actorId}/runs`, {
                json: {
                    ...options,
                    input
                }
            });
            console.log(`Actor ${actorId} run has been started`);
            return response.body;
        } catch (error) {
            console.error('Error running actor:', error.response?.body || error.message);
            throw error;
        }
    }

    async getRunData(runId) {
        try {
            const response = await this.client.get(`runs/${runId}/dataset/items`);
            return response.body;
        } catch (error) {
            console.error('Error getting run data:', error.response?.body || error.message);
            throw error;
        }
    }

    async deleteActor(actorId) {
        try {
            const response = await this.client.delete(`acts/${actorId}`);
            console.log(`Actor ${actorId} deleted successfully`);
            return response.body;
        } catch (error) {
            console.error('Error deleting actor:', error.response?.body || error.message);
            throw error;
        }
    }

    async getActorQuality(actorId) {
        try {
            // Extract just the actor ID without the username prefix
            const cleanActorId = actorId.includes('~') ? actorId.split('~')[1] : actorId;
            const response = await got.get(`https://console-backend.apify.com/actor-quality/scores/${cleanActorId}`, {
                responseType: 'json'
            });
            return response.body;
        } catch (error) {
            console.error('Error getting actor quality:', error.response?.body || error.message);
            return null;
        }
    }

    async getActorRecommendations(actorId) {
        try {
            // Extract just the actor ID without the username prefix
            const cleanActorId = actorId.includes('~') ? actorId.split('~')[1] : actorId;
            const response = await got.get(`https://console-backend.apify.com/actor-quality/praises-and-improvements/${cleanActorId}`, {
                responseType: 'json'
            });
            return response.body;
        } catch (error) {
            console.error('Error getting actor recommendations:', error.response?.body || error.message);
            return null;
        }
    }

    async updateRunOptions(actorId, runOptions) {
        return this.updateActor(actorId, { defaultRunOptions: runOptions });
    }
}


// Simple CLI interface using commander
function main() {
    const program = new Command();

    program
        .name('websy')
        .description('CLI to manage Apify actors')
        .version('1.0.0');

    program
        .command('update')
        .description('Update actor properties using a YAML spec file')
        .option('-i, --id <actorId>', 'Actor ID')
        .option('-s, --spec <path>', 'Path to spec file', './websy-spec.yml')
        .action(async (cmd) => {
            const manager = new Websy();
            const actorId = Websy.resolveActorId(cmd.id);
            const yamlData = Websy.loadSpec(cmd.spec);

            const updates = yamlData?.actor_details;
            if (!updates || typeof updates !== 'object') {
                console.error('Spec must contain `actor_details` as a mapping.');
                process.exit(1);
            }

            if (updates.categories) {
                const validation = Websy.validateCategories(updates.categories);
                if (!validation.valid) {
                    console.error('Category validation error:', validation.message);
                    process.exit(1);
                }
            }

            if (updates.defaultRunOptions && typeof updates.defaultRunOptions !== 'object') {
                console.error('Run options must be an object');
                process.exit(1);
            }

            await manager.updateActor(actorId, updates);
        });

    program
        .command('info')
        .description('Get actor information')
        .option('-i, --id <actorId>', 'Actor ID')
        .option('-s, --spec <path>', 'Path to spec file', './websy-spec.yml')
        .option('-f, --format <format>', 'Output format (json, pretty)', 'pretty')
        .option('--raw', 'Show raw stats object for debugging')
        .action(async (cmd) => {
            try {
                const manager = new Websy();
                const actorId = Websy.resolveActorId(cmd.id);
                const actorInfo = await manager.getActor(actorId);
                const actorData = actorInfo.data;
                
                // Try to load local spec for comparison
                const localSpec = Websy.tryLoadSpec(cmd.spec);
                
                // Fetch quality and recommendations
                const quality = await manager.getActorQuality(actorData.id);
                const recommendations = await manager.getActorRecommendations(actorData.id);
                
                // Fetch public metrics (includes users, ratings, etc.)
                const publicMetrics = await manager.getActorPublicMetrics(actorId);
                
                // Fetch issues metrics
                const issuesMetrics = await manager.getActorIssuesMetrics(actorData.id);

                if (cmd.raw) {
                    console.log('=== Raw Stats Debug ===');
                    console.log('\n--- actorData.stats ---');
                    console.log(JSON.stringify(actorData.stats, null, 2));
                    console.log('\n--- publicMetrics ---');
                    console.log(JSON.stringify(publicMetrics, null, 2));
                    console.log('\n--- issuesMetrics ---');
                    console.log(JSON.stringify(issuesMetrics, null, 2));
                    return;
                }

                if (cmd.format === 'json') {
                    const output = {
                        actor: actorInfo,
                        quality: quality,
                        recommendations: recommendations,
                        publicMetrics: publicMetrics,
                        issuesMetrics: issuesMetrics,
                        warnings: {
                            hasIcon: Websy.hasIcon(actorData)
                        }
                    };
                    if (localSpec) {
                        output.diffs = Websy.compareSpecWithOnline(localSpec, actorData);
                    }
                    console.log(JSON.stringify(output, null, 2));
                } else {
                    console.log('=== Actor Information ===');
                    console.log(`ID:          ${actorData.id}`);
                    console.log(`Name:        ${actorData.name}`);
                    console.log(`Title:       ${actorData.title}`);
                    console.log(`Description: ${actorData.description || 'Not set'}`);
                    console.log(`Version:     ${actorData.versions[0].versionNumber || 'Not available'}`);

                    console.log(`defRunOpts:  ${JSON.stringify(actorData.defaultRunOptions)}`);
                    console.log(`Categories:  ${actorData.categories.join(', ') || 'None'}`);

                    console.log(`IsPublic:    ${actorData.isPublic}`);

                    // Display maintenance status
                    if (actorData.notice && actorData.notice !== 'NONE') {
                        console.log(`\n⚠️  Maintenance: ${actorData.notice}`);
                    }

                    // Icon status
                    const hasIcon = Websy.hasIcon(actorData);
                    if (hasIcon) {
                        console.log(`✅ Icon: Set`);
                    } else {
                        console.log(`⚠️  Icon: Not set`);
                    }

                    // Actor Metrics Section
                    console.log('\n=== Actor Metrics ===');
                    
                    // Stats from actor data
                    const stats = actorData.stats || {};
                    
                    // Users metrics
                    const totalUsers = stats.totalUsers ?? publicMetrics?.stats?.totalUsers ?? 'N/A';
                    const monthlyUsers = stats.totalUsers30Days ?? publicMetrics?.stats?.totalUsers30Days ?? 'N/A';
                    console.log(`Total Users:          ${totalUsers}`);
                    console.log(`Monthly Active Users: ${monthlyUsers}`);
                    
                    // Star rating - check multiple possible locations
                    const avgRating = stats.actorReviewRating ?? publicMetrics?.averageRating ?? publicMetrics?.stats?.averageRating ?? null;
                    const totalRatings = stats.actorReviewCount ?? publicMetrics?.totalRatings ?? publicMetrics?.stats?.totalRatings ?? 0;
                    if (avgRating !== null && totalRatings > 0) {
                        console.log(`Star Rating:          ${avgRating.toFixed(1)} (${totalRatings})`);
                    } else {
                        console.log(`Star Rating:          No ratings yet`);
                    }
                    
                    // Bookmarks - check multiple locations
                    const bookmarks = stats.bookmarkCount ?? publicMetrics?.totalBookmarks ?? publicMetrics?.stats?.totalBookmarks ?? 'N/A';
                    console.log(`Bookmarks:            ${bookmarks}`);
                    
                    // Run statistics - use 30-day stats for success rate
                    const runStats30Days = stats.publicActorRunStats30Days || {};
                    const succeeded30 = runStats30Days.SUCCEEDED ?? 0;
                    const total30 = runStats30Days.TOTAL ?? 0;
                    
                    if (total30 > 0) {
                        const successRate = ((succeeded30 / total30) * 100);
                        const rateDisplay = successRate >= 99 ? '>99' : successRate.toFixed(0);
                        console.log(`Runs Success Rate:    ${rateDisplay}% succeeded (${total30} runs in 30d)`);
                    } else {
                        const totalRuns = stats.totalRuns ?? 'N/A';
                        console.log(`Total Runs:           ${totalRuns}`);
                    }
                    
                    // Issue response time
                    const issueResponseMs = issuesMetrics?.averageResponseTimeMs ?? publicMetrics?.averageIssueResponseTimeMs ?? publicMetrics?.stats?.averageIssueResponseTimeMs ?? null;
                    if (issueResponseMs !== null) {
                        console.log(`Issue Response Time:  ${Websy.formatDuration(issueResponseMs)}`);
                    } else {
                        console.log(`Issue Response Time:  N/A`);
                    }
                    
                    // Created and Modified dates (exact month/year)
                    const createdAt = new Date(actorData.createdAt);
                    const modifiedAt = new Date(actorData.modifiedAt);
                    console.log(`Created:              ${Websy.formatMonthYear(createdAt)}`);
                    console.log(`Modified:             ${Websy.formatMonthYear(modifiedAt)}`);
                    
                    // Display quality information
                    if (quality) {
                        console.log('\n=== Actor Quality ===');
                        console.log(`Quality Score:      ${(quality.actorQuality * 100).toFixed(2)}%`);
                        console.log(`Quality Percentile: ${(quality.actorQualityPercentile * 100).toFixed(2)}%`);
                    }
                    
                    // Display recommendations
                    if (recommendations) {
                        if (recommendations.praises && recommendations.praises.length > 0) {
                            console.log('\n=== Praises ===');
                            recommendations.praises.forEach((praise, index) => {
                                console.log(`${index + 1}. ${praise.title} (Percentile: ${(praise.percentile * 100).toFixed(0)}%)`);
                            });
                        }
                        
                        if (recommendations.improvements && recommendations.improvements.length > 0) {
                            console.log('\n=== Improvements ===');
                            recommendations.improvements.forEach((improvement, index) => {
                                console.log(`${index + 1}. ${improvement.title}`);
                            });
                        }
                    }

                    // Compare local spec with online data
                    if (localSpec) {
                        const diffs = Websy.compareSpecWithOnline(localSpec, actorData);
                        if (diffs.length > 0) {
                            console.log('\n=== Local vs Online Diffs ===');
                            console.log('⚠️  The following fields differ between local spec and online:');
                            for (const diff of diffs) {
                                console.log(`\n  ${diff.field}:`);
                                console.log(`    Local:  ${JSON.stringify(diff.local)}`);
                                console.log(`    Online: ${JSON.stringify(diff.online)}`);
                            }
                            console.log('\n💡 Run "websy update" to sync local spec to online.');
                        } else {
                            console.log('\n✅ Local spec is in sync with online actor.');
                        }
                    } else {
                        console.log(`\n📄 No local spec found at ${cmd.spec}`);
                    }
                }
            } catch (error) {
                console.error(`Failed to get actor info: ${error.message}`);
                process.exit(1);
            }
        });

    program
        .command('gen-schemas')
        .description('Generate all .actor/*.json schema files from websy-spec.yml')
        .option('-s, --spec <path>', 'Path to spec file', './websy-spec.yml')
        .option('--dry-run', 'Preview generated schemas without writing files')
        .option('-v, --verbose', 'Show detailed output')
        .action(async (cmd) => {
            try {
                const yamlData = Websy.loadSpec(cmd.spec);
                
                if (!yamlData.schemas) {
                    console.error('Spec must contain a `schemas` section.');
                    process.exit(1);
                }
                
                const manager = new ActorSchemaManager(yamlData.schemas, {
                    dryRun: cmd.dryRun,
                    verbose: cmd.verbose
                });
                
                // Validate config first
                const validation = manager.validate();
                if (!validation.valid) {
                    console.error('Schema validation errors:');
                    validation.errors.forEach(err => console.error(`  - ${err}`));
                    process.exit(1);
                }
                
                const schemas = manager.generateAllSchemas();
                
                if (cmd.dryRun) {
                    console.log('\n=== DRY RUN - Generated Schemas ===\n');
                    console.log('--- actor.json ---');
                    console.log(JSON.stringify(schemas.actor, null, 2));
                    console.log('\n--- input_schema.json ---');
                    console.log(JSON.stringify(schemas.inputSchema, null, 2));
                    console.log('\n--- dataset_schema.json ---');
                    console.log(JSON.stringify(schemas.datasetSchema, null, 2));
                    console.log('\n--- output_schema.json ---');
                    console.log(JSON.stringify(schemas.outputSchema, null, 2));
                    console.log('\n🚨 Dry run mode - no files written. Use without --dry-run to write files.');
                }
                
            } catch (error) {
                console.error(`Failed to generate schemas: ${error.message}`);
                process.exit(1);
            }
        });

    program
        .command('gen-input')
        .description('Generate INPUT.json file with default values from websy-spec.yml')
        .option('-s, --spec <path>', 'Path to spec file', './websy-spec.yml')
        .option('-o, --output <path>', 'Output path for INPUT.json', './INPUT.json')
        .option('--dry-run', 'Preview generated input without writing file')
        .option('-v, --verbose', 'Show detailed output')
        .action(async (cmd) => {
            try {
                const yamlData = Websy.loadSpec(cmd.spec);
                
                if (!yamlData.schemas) {
                    console.error('Spec must contain a `schemas` section.');
                    process.exit(1);
                }
                
                const manager = new ActorSchemaManager(yamlData.schemas, {
                    dryRun: cmd.dryRun,
                    verbose: cmd.verbose
                });
                
                const defaults = manager.generateInputFile(cmd.output);
                
                if (cmd.dryRun) {
                    console.log('\n=== DRY RUN - Generated INPUT.json ===\n');
                    console.log(JSON.stringify(defaults, null, 2));
                    console.log('\n🚨 Dry run mode - no files written. Use without --dry-run to write files.');
                }
                
            } catch (error) {
                console.error(`Failed to generate input file: ${error.message}`);
                process.exit(1);
            }
        });

    program.parse();
}

// ES module equivalent of "run only if executed directly"
if( process.argv[1] === fileURLToPath(import.meta.url))
    main();

export default Websy;
