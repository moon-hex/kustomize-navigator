# --------------------------------------------------------------------------------------------------
# Build Script for Kustomize Navigator Extension
#
# This script performs the following steps:
# 1. Compiles the extension using webpack (as configured in package.json).
# 2. Packages the extension into a VSIX file, outputting the package into the './output' directory.
#
# Notes:
# - Ensure you have run 'npm install' to install all dependencies.
# - If necessary, update npm globally to version 11.3.0:
#       npm install -g npm@11.3.0
# - The '@types/js-yaml' type definitions are required for proper TypeScript support.
#
# After packaging, upload the generated VSIX file from the output folder to the Visual Studio Marketplace.
# --------------------------------------------------------------------------------------------------

# Step 1: Compile the extension using webpack
npm run compile 

# Step 2: Package the extension into a VSIX file and output it to the './output' directory.
vsce package --out ./output