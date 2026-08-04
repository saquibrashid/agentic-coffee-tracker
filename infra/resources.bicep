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
@secure()
param bingSearchKey string
param scrapeAllowlist string

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
}

var deploymentContainerName = 'deploymentpackage'

// Secrets are only provisioned when a value was supplied. The BFF falls back to
// deterministic mocks when a key is absent, so a credential-free deployment is a
// supported, fully working configuration.
var hasVision = !empty(visionKey) && !empty(visionEndpoint)
var hasOpenAi = !empty(openAiKey) && !empty(openAiEndpoint) && !empty(openAiDeployment)
var hasBing = !empty(bingSearchKey)

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

resource visionKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (hasVision) {
  parent: keyVault
  name: 'azure-vision-key'
  properties: { value: visionKey }
}

resource openAiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (hasOpenAi) {
  parent: keyVault
  name: 'azure-openai-key'
  properties: { value: openAiKey }
}

resource bingKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (hasBing) {
  parent: keyVault
  name: 'bing-search-key'
  properties: { value: bingSearchKey }
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

var visionSettings = hasVision ? [
  {
    name: 'AZURE_VISION_ENDPOINT'
    value: visionEndpoint
  }
  {
    name: 'AZURE_VISION_KEY'
    value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/azure-vision-key/)'
  }
] : []

var openAiSettings = hasOpenAi ? [
  {
    name: 'AZURE_OPENAI_ENDPOINT'
    value: openAiEndpoint
  }
  {
    name: 'AZURE_OPENAI_KEY'
    value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/azure-openai-key/)'
  }
  {
    name: 'AZURE_OPENAI_DEPLOYMENT'
    value: openAiDeployment
  }
] : []

var bingSettings = hasBing ? [
  {
    name: 'BING_SEARCH_KEY'
    value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/bing-search-key/)'
  }
] : []

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
      appSettings: concat(baseAppSettings, visionSettings, openAiSettings, bingSettings)
    }
  }
  dependsOn: [
    deploymentContainer
    storageBlobDataOwner
    keyVaultSecretsUser
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
      RequestUrl: 'https://${functionApp.properties.defaultHostName}/api/health'
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
