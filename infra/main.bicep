targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment. Used to derive resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Optional. Bring-your-own Azure AI Vision endpoint. Leave empty to use the account this template provisions.')
param visionEndpoint string = ''

@secure()
@description('Optional. Azure AI Vision key. Stored in Key Vault, never in app settings.')
param visionKey string = ''

@description('Optional. Bring-your-own Azure OpenAI endpoint. Leave empty to use the account this template provisions.')
param openAiEndpoint string = ''

@secure()
@description('Optional. Azure OpenAI key. Stored in Key Vault, never in app settings.')
param openAiKey string = ''

@description('Optional. Azure OpenAI chat deployment name. Defaults to the model this template deploys.')
param openAiDeployment string = ''

@secure()
@description('Optional. Bing Web Search key. Stored in Key Vault, never in app settings.')
param bingSearchKey string = ''

@description('Comma-separated hosts the /api/scrape endpoint is allowed to fetch. `*.example` is reserved by RFC 2606, never resolves, and enables the credential-free mock path.')
param scrapeAllowlist string = '*.example,bluebottlecoffee.com,counterculturecoffee.com,intelligentsiacoffee.com'

@allowed(['Free', 'Standard'])
@description('Static Web App SKU. Standard adds linked backends (same-origin /api) but is not free.')
param staticWebAppSkuName string = 'Free'

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    resourceToken: resourceToken
    tags: tags
    visionEndpoint: visionEndpoint
    visionKey: visionKey
    openAiEndpoint: openAiEndpoint
    openAiKey: openAiKey
    openAiDeployment: openAiDeployment
    bingSearchKey: bingSearchKey
    scrapeAllowlist: scrapeAllowlist
    staticWebAppSkuName: staticWebAppSkuName
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output SERVICE_API_NAME string = resources.outputs.functionAppName
output SERVICE_API_URI string = resources.outputs.functionAppUri
output SERVICE_WEB_NAME string = resources.outputs.staticWebAppName
output SERVICE_WEB_URI string = resources.outputs.staticWebAppUri
output APPLICATIONINSIGHTS_CONNECTION_STRING string = resources.outputs.appInsightsConnectionString
output AZURE_KEY_VAULT_NAME string = resources.outputs.keyVaultName

// The SPA calls the BFF through the Static Web App's linked backend when that is
// available (Standard SKU), in which case /api is same-origin and this is empty.
output VITE_API_BASE_URL string = resources.outputs.apiBaseUrl
