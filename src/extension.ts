import * as vscode from 'vscode';
import { KustomizeFileWatcher } from './fileWatcher';
import { KustomizeLinkProvider } from './linkProvider';
import { KustomizeHoverProvider } from './hoverProvider';
import { FluxVariableDecorator } from './fluxDecorator';
import { FluxCompletionProvider } from './fluxCompletionProvider';
import { FluxDiagnosticProvider } from './fluxDiagnostics';
import { KustomizeParser } from './kustomizeParser';
import { KustomizeReferencesView } from './kustomizeReferencesView';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Kustomize Navigator checking if workspace contains kustomization files...');

    // Get the workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.log('Kustomize Navigator: No workspace folder is open');
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    
    // Check for kustomization files before initializing watcher
    const parser = new KustomizeParser(workspaceRoot);
    const kustomizationFiles = await parser.findKustomizationFiles();

    if (kustomizationFiles.length === 0) {
        console.log('Kustomize Navigator: No kustomization files found in workspace, not activating extension');
        return;
    }
    
    console.log(`Kustomize Navigator extension is now active (found ${kustomizationFiles.length} kustomization files)`);
    
    // Initialize the file watcher only if we found kustomization files
    const fileWatcher = new KustomizeFileWatcher(workspaceRoot);
    await fileWatcher.initialize();
    
    // Register link provider
    const linkProvider = new KustomizeLinkProvider(fileWatcher.getParser());
    const linkProviderDisposable = vscode.languages.registerDocumentLinkProvider(
        { language: 'yaml' },
        linkProvider
    );
    

    // Register hover provider
    const hoverProvider = new KustomizeHoverProvider(fileWatcher.getParser());
    const hoverProviderDisposable = vscode.languages.registerHoverProvider(
        { language: 'yaml' },
        hoverProvider
    );

    // Check if variable highlighting is enabled in config
    const config = vscode.workspace.getConfiguration('kustomizeNavigator');
    const highlightEnabled = config.get<boolean>('highlightFluxVariables', true);

    let fluxDecorator;
    if (highlightEnabled) {
        // Register Flux variable decorator
        fluxDecorator = new FluxVariableDecorator();
        context.subscriptions.push(fluxDecorator);
    }

    // Register Flux variable completion provider
    const completionProvider = new FluxCompletionProvider();
    const completionProviderDisposable = vscode.languages.registerCompletionItemProvider(
        { language: 'yaml' },
        completionProvider,
        '$', '{' // Triggered by ${
    );

    // Register Flux diagnostic provider
    const diagnosticProvider = new FluxDiagnosticProvider();
    
    // Register references view
    const referencesView = new KustomizeReferencesView(fileWatcher.getParser());
    
    // Register refresh command for references view
    const refreshCommand = vscode.commands.registerCommand('kustomizeNavigator.refreshReferences', () => {
        referencesView.refresh();
    });
    
    // Register open file command for references view
    const openFileCommand = vscode.commands.registerCommand('kustomizeNavigator.openFile', (uri: vscode.Uri) => {
        vscode.commands.executeCommand('vscode.open', uri);
    });
    
    // Register dependencies visualization command
    const visualizeCommand = vscode.commands.registerCommand('kustomizeNavigator.visualizeDependencies', async () => {
        // Check if there's an active editor
        if (!vscode.window.activeTextEditor) {
            vscode.window.showInformationMessage('Open a Kustomize file to visualize dependencies');
            return;
        }
        
        const filePath = vscode.window.activeTextEditor.document.uri.fsPath;
        
        // Check if this is a kustomization file
        if (!fileWatcher.getParser().isKustomizationFile(filePath)) {
            vscode.window.showInformationMessage('This is not a Kustomize file');
            return;
        }
        
        // Generate a graph visualization
        const panel = vscode.window.createWebviewPanel(
            'kustomizeGraph',
            'Kustomize Dependencies',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        
        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openFile':
                        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.filePath));
                        return;
                }
            },
            undefined,
            context.subscriptions
        );
        
        // Generate graph data
        const graphData = await generateDependencyGraph(fileWatcher.getParser(), filePath);
        
        // Set HTML content with visualization
        panel.webview.html = getGraphWebviewContent(graphData);
    });

    // Add disposables to context.subscriptions
    context.subscriptions.push(
        fileWatcher,
        linkProviderDisposable,
        linkProvider,
        hoverProviderDisposable,
        completionProviderDisposable,
        diagnosticProvider,
        refreshCommand,
        openFileCommand,
        visualizeCommand
    );

    // Log success
    vscode.window.showInformationMessage(`Kustomize Navigator: Initialized successfully (found ${kustomizationFiles.length} kustomization files)`);
}

// Helper to generate graph data for dependency visualization
async function generateDependencyGraph(parser: KustomizeParser, startFilePath: string): Promise<any> {
    const nodes: any[] = [];
    const edges: any[] = [];
    const processedFiles = new Set<string>();
    
    // Process a file and its references
    async function processFile(filePath: string, depth: number = 0) {
        // Skip if already processed to avoid cycles
        if (processedFiles.has(filePath)) {
            return;
        }
        
        processedFiles.add(filePath);
        
        // Add node for this file
        const isKustomization = parser.isKustomizationFile(filePath);
        const label = isKustomization ? 
            `${path.basename(path.dirname(filePath))}/${path.basename(filePath)}` : 
            path.basename(filePath);
        
        nodes.push({
            id: filePath,
            label: label,
            group: isKustomization ? 'kustomization' : 'resource'
        });
        
        // If not a kustomization or reached max depth, don't process further
        if (!isKustomization || depth > 3) {
            return;
        }
        
        // Get references from this file
        const references = parser.getReferencesForFile(filePath) || [];
        
        // Process each reference
        for (const ref of references) {
            // Add edge from this file to the reference
            edges.push({
                from: filePath,
                to: ref
            });
            
            // Process the referenced file
            await processFile(ref, depth + 1);
        }
    }
    
    // Start processing from the initial file
    await processFile(startFilePath);
    
    return { nodes, edges };
}

// Helper for WebView HTML content
function getGraphWebviewContent(graphData: any): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kustomize Dependencies</title>
    <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <style>
        body, html {
            height: 100%;
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Ubuntu', sans-serif;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        #network {
            width: 100%;
            height: 100vh;
        }
        .legend {
            position: absolute;
            bottom: 10px;
            left: 10px;
            padding: 10px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            z-index: 1000;
        }
        .legend-item {
            display: flex;
            align-items: center;
            margin-bottom: 5px;
        }
        .legend-color {
            width: 15px;
            height: 15px;
            border-radius: 50%;
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div id="network"></div>
    <div class="legend">
        <div class="legend-item">
            <div class="legend-color" style="background-color: #4CAF50;"></div>
            <span>Kustomization</span>
        </div>
        <div class="legend-item">
            <div class="legend-color" style="background-color: #2196F3;"></div>
            <span>Resource</span>
        </div>
    </div>
    <script>
        // Create a network
        var container = document.getElementById('network');
        
        // Prepare data
        var nodes = new vis.DataSet(${JSON.stringify(graphData.nodes)});
        var edges = new vis.DataSet(${JSON.stringify(graphData.edges)});
        
        // Provide the data in the vis format
        var data = {
            nodes: nodes,
            edges: edges
        };
        
        // Define options
        var options = {
            nodes: {
                shape: 'dot',
                size: 16,
                font: {
                    size: 14,
                    color: 'var(--vscode-editor-foreground)'
                },
                borderWidth: 2,
                shadow: true
            },
            edges: {
                width: 2,
                color: {
                    color: 'var(--vscode-editor-foreground)',
                    opacity: 0.7
                },
                arrows: {
                    to: { enabled: true, scaleFactor: 1 }
                },
                smooth: {
                    type: 'continuous',
                    roundness: 0.6
                }
            },
            physics: {
                stabilization: true,
                barnesHut: {
                    gravitationalConstant: -8000,
                    centralGravity: 0.3,
                    springLength: 95,
                    springConstant: 0.04,
                    damping: 0.09
                }
            },
            groups: {
                kustomization: {
                    color: {
                        background: '#4CAF50',
                        border: '#388E3C',
                        highlight: {
                            background: '#66BB6A',
                            border: '#388E3C'
                        }
                    }
                },
                resource: {
                    color: {
                        background: '#2196F3',
                        border: '#1565C0',
                        highlight: {
                            background: '#42A5F5',
                            border: '#1565C0'
                        }
                    }
                }
            },
            layout: {
                hierarchical: {
                    enabled: true,
                    direction: 'UD',
                    sortMethod: 'directed',
                    levelSeparation: 150,
                    nodeSpacing: 180
                }
            }
        };
        
        // Initialize the network
        var network = new vis.Network(container, data, options);
        
        // Handle click events
        network.on("doubleClick", function(params) {
            if (params.nodes.length > 0) {
                // Get the node id (file path)
                var nodeId = params.nodes[0];
                
                // Send message to VS Code
                window.parent.postMessage({
                    command: 'openFile',
                    filePath: nodeId
                }, '*');
            }
        });
    </script>
</body>
</html>`;
}

export function deactivate() {
    // Cleanup will be handled by the disposables
}

// Import path for the visualization HTML
import * as path from 'path';