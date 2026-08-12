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

@description('Optional. Azure OpenAI image deployment name, used by /api/studio-photo to re-shoot bag photos as studio product shots. Empty (the default) leaves that endpoint in mock mode, which is deliberate: image generation is billed per image and the image models are not available on every subscription.')
param openAiImageDeployment string = ''

@description('Optional. Image model for this template to deploy so that openAiImageDeployment has something to point at, e.g. "gpt-image-1". Empty (the default) deploys none. Ignored when openAiImageDeployment names a deployment you already have.')
param openAiImageModelName string = ''

@description('Optional. Comma-separated hosts the /api/scrape endpoint may fetch. Empty (the default) allows any publicly routable host, which is what lets enrichment read arbitrary roaster storefronts; the endpoint still refuses private, loopback, and link-local addresses on every redirect hop. Set this to pin the deployment to a fixed set of stores.')
param scrapeAllowlist string = ''

@allowed(['owner', 'allowlist', 'open'])
@description('Who may use sync once signed in. "owner" and "allowlist" admit only the accounts named in syncAllowlist; "open" admits any signed-in Microsoft account. Defaults to closed, because authentication alone is not a restriction — Microsoft accounts are free and unlimited.')
param syncAccessMode string = 'owner'

@description('Comma-separated user ids or sign-in names permitted to sync. An empty list denies everyone, including the owner: treating unconfigured as unrestricted would open the deployment the moment this parameter went missing. Sign in and visit /.auth/me to find your userId.')
param syncAllowlist string = ''

@description('Ceiling on live sync records in one user partition, as a positive integer. Bounds a runaway client that would otherwise write documents indefinitely. A value the API cannot parse falls back to its 20,000 default rather than failing the deploy, so a typo cannot lock anyone out of their own data.')
param syncRecordQuota string = '20000'

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
    openAiImageDeployment: openAiImageDeployment
    openAiImageModelName: openAiImageModelName
    scrapeAllowlist: scrapeAllowlist
    syncAccessMode: syncAccessMode
    syncAllowlist: syncAllowlist
    syncRecordQuota: syncRecordQuota
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

// Both empty on the Free SKU, where sync is refused for the reason in
// specs/sync.md -> Identity. Their presence is what /api/health reports as
// sync: 'live'.
output AZURE_COSMOS_ACCOUNT_NAME string = resources.outputs.cosmosAccountName
output AZURE_PHOTO_STORAGE_ACCOUNT_NAME string = resources.outputs.photoStorageAccountName

// The SPA calls the BFF through the Static Web App's linked backend when that is
// available (Standard SKU), in which case /api is same-origin and this is empty.
output VITE_API_BASE_URL string = resources.outputs.apiBaseUrl

// Sign-in is offered exactly when the topology makes an identity trustworthy,
// which is the same condition. SWA's pre-configured 'aad' provider needs no app
// registration — it authorises against login.microsoftonline.com/common, so
// both work/school and personal Microsoft accounts work out of the box.
//
// Deriving this from infrastructure rather than setting it by hand keeps CI and
// local builds honest: there is no way to end up with a sign-in button on a
// topology that cannot verify the resulting identity.
output VITE_AUTH_ENABLED string = staticWebAppSkuName == 'Standard' ? 'true' : 'false'
