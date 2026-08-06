@description('Location for all resources.')
param location string

@minLength(13)
@description('Deterministic suffix that keeps globally-unique names stable per environment.')
param resourceToken string

param tags object

param visionEndpoint string
@secure()
param visionKey string
param openAiEndpoint string
@secure()
param openAiKey string
param openAiDeployment string
param scrapeAllowlist string

@description('SKU for the Azure AI Vision account. F0 is free (5,000 transactions/month) but a subscription may only hold one F0 Computer Vision account — use S1 for a second environment.')
param visionSkuName string = 'F0'

@description('Model deployed for bag parsing. Must support strict structured outputs, which /api/parse relies on. Note that the gpt-5 family rejects the `temperature` parameter the BFF sends, so switching to it needs a code change.')
param openAiModelName string = 'gpt-4o'

param openAiModelVersion string = '2024-11-20'

@description('Thousands of tokens per minute for the model deployment.')
param openAiCapacity int = 10

@description('Name of the Foundry project created under the Azure OpenAI account. The new Foundry portal only surfaces projects, not bare accounts.')
param openAiProjectName string = 'coffee-tracker'

@allowed(['Free', 'Standard'])
@description('Static Web App SKU. Standard is required for linked backends.')
param staticWebAppSkuName string

var useLinkedBackend = staticWebAppSkuName == 'Standard'

var abbrev = {
  functionApp: 'func-${resourceToken}'
  plan: 'plan-${resourceToken}'
  storage: 'st${resourceToken}'
  keyVault: 'kv-${resourceToken}'
  logAnalytics: 'log-${resourceToken}'
  appInsights: 'appi-${resourceToken}'
  staticWebApp: 'stapp-${resourceToken}'
  vision: 'vision-${resourceToken}'
  openAi: 'oai-${resourceToken}'
}

var deploymentContainerName = 'deploymentpackage'

// The AI accounts below are always provisioned, so the app can actually read a
// coffee bag on a fresh deployment. Supplying visionEndpoint/openAiEndpoint (and
// their keys) overrides them with a bring-your-own resource instead.
//
// Because the accounts always exist, referencing them here is unconditional and
// avoids the `if()` short-circuit pitfalls of conditionally-deployed resources.
var effectiveVisionEndpoint = empty(visionEndpoint) ? vision.properties.endpoint : visionEndpoint
var effectiveVisionKey = empty(visionKey) ? vision.listKeys().key1 : visionKey
// Deliberately NOT openAi.properties.endpoint. On a Foundry ('AIServices')
// account that property returns the generic *.cognitiveservices.azure.com
// hostname, whereas the documented base URL for the /openai/v1 data plane is
// *.openai.azure.com. Both currently answer, but only the latter is contractual,
// and pinning it keeps AZURE_OPENAI_ENDPOINT byte-identical to its pre-upgrade
// value. The hostname is derived from customSubDomainName, set on the account
// below to this same name.
var provisionedOpenAiEndpoint = 'https://${abbrev.openAi}.openai.azure.com/'
var effectiveOpenAiEndpoint = empty(openAiEndpoint) ? provisionedOpenAiEndpoint : openAiEndpoint
var effectiveOpenAiKey = empty(openAiKey) ? openAi.listKeys().key1 : openAiKey
var effectiveOpenAiDeployment = empty(openAiDeployment) ? openAiModelName : openAiDeployment

// The BFF still falls back to deterministic mocks when a key is absent, which is
// what local development runs on. In Azure the credentials are always present,
// so the Vision/OpenAI secrets and settings below are unconditional.

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: abbrev.logAnalytics
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: abbrev.appInsights
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    // Keys are not needed; the Functions host uses the connection string.
    DisableLocalAuth: false
  }
}

// ---------------------------------------------------------------------------
// Storage (Functions runtime + Flex Consumption deployment package)
// ---------------------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: abbrev.storage
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // The Function App authenticates with its managed identity, so shared keys
    // are never needed and are switched off.
    allowSharedKeyAccess: false
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobServices
  name: deploymentContainerName
  properties: { publicAccess: 'None' }
}

// ---------------------------------------------------------------------------
// Azure AI — Vision reads the bag label, OpenAI turns that text into fields
// ---------------------------------------------------------------------------

resource vision 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: abbrev.vision
  location: location
  tags: tags
  kind: 'ComputerVision'
  sku: { name: visionSkuName }
  properties: {
    // Required for the account to get its own *.cognitiveservices.azure.com
    // hostname, which the imageanalysis REST call is issued against.
    customSubDomainName: abbrev.vision
    publicNetworkAccess: 'Enabled'
  }
}

// A Foundry resource (kind 'AIServices' with project management enabled) is the
// current shape of an Azure OpenAI account. Accounts still on kind 'OpenAI' work
// but only render in the classic portal, so this template provisions the modern
// kind and a project child. The endpoint, keys and deployments are identical
// either way — the BFF keeps calling {endpoint}/openai/v1/responses with an
// api-key header, so no application code depends on this choice.
resource openAi 'Microsoft.CognitiveServices/accounts@2026-05-01' = {
  name: abbrev.openAi
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  // Required by the Foundry resource model. This identity belongs to the
  // account itself; the BFF still authenticates with an API key, so nothing
  // here makes managed identity a prerequisite for the application.
  identity: { type: 'SystemAssigned' }
  properties: {
    // Preserved from the pre-upgrade account so the existing
    // https://<abbrev.openAi>.openai.azure.com hostname keeps resolving.
    customSubDomainName: abbrev.openAi
    publicNetworkAccess: 'Enabled'
    allowProjectManagement: true
    // The upgrade guidance defaults this to true, which would break the
    // api-key auth the Function App relies on via Key Vault.
    disableLocalAuth: false
  }
}

// The new Foundry portal works in terms of projects, not bare accounts. Without
// this child the resource is invisible there even though it is fully functional.
resource openAiProject 'Microsoft.CognitiveServices/accounts/projects@2026-05-01' = {
  parent: openAi
  name: openAiProjectName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    displayName: openAiProjectName
    description: 'Foundry project for the Agentic Coffee Tracker BFF.'
  }
}

resource openAiModelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2026-05-01' = {
  parent: openAi
  name: openAiModelName
  sku: {
    name: 'GlobalStandard'
    capacity: openAiCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: openAiModelVersion
    }
  }
}

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: abbrev.keyVault
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource visionKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-vision-key'
  properties: { value: effectiveVisionKey }
}

resource openAiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-openai-key'
  properties: { value: effectiveOpenAiKey }
}

// ---------------------------------------------------------------------------
// Function App (BFF) on Flex Consumption
// ---------------------------------------------------------------------------

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: abbrev.plan
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

var keyVaultUri = keyVault.properties.vaultUri

var baseAppSettings = [
  {
    name: 'AzureWebJobsStorage__accountName'
    value: storage.name
  }
  {
    name: 'AzureWebJobsStorage__credential'
    value: 'managedidentity'
  }
  {
    name: 'AzureWebJobsStorage__clientId'
    value: functionAppIdentity.properties.clientId
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsights.properties.ConnectionString
  }
  {
    name: 'SCRAPE_ALLOWLIST'
    value: scrapeAllowlist
  }
  {
    name: 'ALLOWED_ORIGINS'
    value: 'https://${staticWebApp.properties.defaultHostname}'
  }
]

var visionSettings = [
  {
    name: 'AZURE_VISION_ENDPOINT'
    value: effectiveVisionEndpoint
  }
  {
    name: 'AZURE_VISION_KEY'
    value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/azure-vision-key/)'
  }
]

var openAiSettings = [
  {
    name: 'AZURE_OPENAI_ENDPOINT'
    value: effectiveOpenAiEndpoint
  }
  {
    name: 'AZURE_OPENAI_KEY'
    value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/azure-openai-key/)'
  }
  {
    name: 'AZURE_OPENAI_DEPLOYMENT'
    value: effectiveOpenAiDeployment
  }
]

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: abbrev.functionApp
  location: location
  // azd matches this tag against the service name in azure.yaml.
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${functionAppIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // Key Vault references are resolved with the same identity that holds the
    // Key Vault Secrets User role.
    keyVaultReferenceIdentity: functionAppIdentity.id
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: functionAppIdentity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '20'
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: [
          'https://${staticWebApp.properties.defaultHostname}'
          'https://portal.azure.com'
        ]
        supportCredentials: false
      }
      appSettings: concat(baseAppSettings, visionSettings, openAiSettings)
    }
  }
  dependsOn: [
    deploymentContainer
    storageBlobDataOwner
    keyVaultSecretsUser
    // The app settings resolve these by Key Vault URI at startup. Without an
    // explicit dependency the secrets can lag the app, which resolves to an
    // empty value and silently drops the BFF into mock mode.
    visionKeySecret
    openAiKeySecret
    openAiModelDeployment
  ]
}

// ---------------------------------------------------------------------------
// Role assignments for the Function App's managed identity
// ---------------------------------------------------------------------------

// Storage Blob Data Owner — required for Flex Consumption identity-based deploys.
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
// Key Vault Secrets User — read-only access to the AI keys.
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource storageBlobDataOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, abbrev.functionApp, storageBlobDataOwnerRoleId)
  properties: {
    principalId: functionAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      storageBlobDataOwnerRoleId
    )
  }
}

resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, abbrev.functionApp, keyVaultSecretsUserRoleId)
  properties: {
    principalId: functionAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      keyVaultSecretsUserRoleId
    )
  }
}

// A user-assigned identity breaks the circular dependency between the site (which
// needs its role assignments to exist first) and the role assignments (which need
// the site's principal id).
resource functionAppIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${resourceToken}'
  location: location
  tags: tags
}

// ---------------------------------------------------------------------------
// Static Web App (SPA) with the Function App as a linked backend
// ---------------------------------------------------------------------------

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: abbrev.staticWebApp
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: {
    name: staticWebAppSkuName
    tier: staticWebAppSkuName
  }
  properties: {
    // Deployment is driven by azd / the deploy workflow, not by SWA's own build.
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

// Makes /api on the SPA origin proxy to the Function App, so the browser never
// makes a cross-origin call and no API base URL is baked into the bundle.
// Linked backends require the Standard SKU; on Free the SPA calls the Function
// App cross-origin instead (CORS is configured above).
resource linkedBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = if (useLinkedBackend) {
  parent: staticWebApp
  name: 'api'
  properties: {
    backendResourceId: functionApp.id
    region: location
  }
}

// ---------------------------------------------------------------------------
// Synthetic availability check against the anonymous /api/health probe
//
// COST: billed per location per run, and it is the single largest line item in
// this template — 3 locations every 5 minutes is ~26,000 runs/month (~$26).
// Everything else here totals under a dollar. Lower Frequency or trim Locations
// to cut it proportionally; see docs/deployment.md#what-this-costs.
// ---------------------------------------------------------------------------

resource availabilityTest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: 'health-${resourceToken}'
  location: location
  // Links the test to the Application Insights component so results show up
  // under Availability. The key must be the component resource id.
  tags: union(tags, {
    'hidden-link:${appInsights.id}': 'Resource'
  })
  kind: 'standard'
  properties: {
    Name: 'api-health'
    SyntheticMonitorId: 'health-${resourceToken}'
    Enabled: true
    Frequency: 300
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [
      { Id: 'us-il-ch1-azr' }
      { Id: 'us-ca-sjc-azr' }
      { Id: 'emea-nl-ams-azr' }
    ]
    Request: {
      // Linking the backend enables Easy Auth on the Function App, so its own
      // hostname answers 401 to a synthetic probe. Probe the front door the
      // real clients use instead.
      RequestUrl: useLinkedBackend
        ? 'https://${staticWebApp.properties.defaultHostname}/api/health'
        : 'https://${functionApp.properties.defaultHostName}/api/health'
      HttpVerb: 'GET'
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
    }
  }
}

output functionAppName string = functionApp.name
output functionAppUri string = 'https://${functionApp.properties.defaultHostName}'
output staticWebAppName string = staticWebApp.name
output staticWebAppUri string = 'https://${staticWebApp.properties.defaultHostname}'
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output keyVaultName string = keyVault.name

// Empty when the SPA can reach the BFF same-origin via the linked backend.
output apiBaseUrl string = useLinkedBackend ? '' : 'https://${functionApp.properties.defaultHostName}'
