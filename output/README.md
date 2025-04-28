# Publishing the Extension to the Visual Studio Marketplace

## Before You Publish
Ensure you have a publisher account on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/).

## Publish the Extension
Use the [VSIX Publisher Tool](https://learn.microsoft.com/en-us/visualstudio/extensibility/vsixpublisher) to upload your extension package. Replace the placeholder paths with your actual file locations:

````bash
vsixpublisher publish -payload <path-to-vsix-file> -publishManifest <path-to-publish-manifest>
````

## Additional Resources
- [Visual Studio Extensibility Documentation](https://learn.microsoft.com/en-us/visualstudio/extensibility/overview)
- [Troubleshooting VSIX Extensions](https://learn.microsoft.com/en-us/visualstudio/extensibility/troubleshooting)
