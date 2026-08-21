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
param imageEndpoint string
@secure()
param imageKey string
param imageDeployment string
param scrapeAllowlist string

@description('Repository that in-app feedback is filed into, as "owner/name". Empty leaves /api/feedback reporting itself as disabled rather than silently swallowing what people write.')
param feedbackRepo string = ''

@secure()
@description('A GitHub token with issue-creation permission on feedbackRepo, and nothing else. Empty disables the feedback endpoint.')
param feedbackToken string = ''

@allowed(['owner', 'allowlist', 'open'])
@description('Who may use sync. "owner"/"allowlist" admit only the accounts in syncAllowlist; "open" admits any signed-in account. Defaults to closed.')
param syncAccessMode string = 'owner'

@description('Comma-separated user ids or sign-in names permitted to sync. Empty denies everyone, including the owner. Find your id at /.auth/me after signing in.')
param syncAllowlist string = ''

@description('Ceiling on live sync records in one user partition, as a positive integer. A value the API cannot parse falls back to its 20,000 default rather than failing the deploy.')
param syncRecordQuota string = '20000'

@description('SKU for the Azure AI Vision account. F0 is free (5,000 transactions/month) but a subscription may only hold one F0 Computer Vision account — use S1 for a second environment.')
param visionSkuName string = 'F0'

@description('Model deployed for bag parsing. Must support strict structured outputs (used by /api/parse and /api/recommend), the `temperature` parameter the BFF always sends, and the hosted `web_search` tool used by /api/search. Measured on the real prompts: gpt-5.4-mini matches gpt-4o on field accuracy at ~2.6x lower cost and ~20% lower median latency. The gpt-5.6 line still rejects `temperature`, so adopting it would need a code change - see docs/deployment.md.')
param openAiModelName string = 'gpt-5.4-mini'

param openAiModelVersion string = '2026-03-17'

@description('Thousands of tokens per minute for the model deployment.')
param openAiCapacity int = 10

@description('Name of the MAI image model to deploy for /api/studio-photo. Empty (the default) deploys none, which leaves studio shots in mock mode — the model is in preview, is not available on every subscription, and each generated image is billed.')
param imageModelName string = ''

param imageModelVersion string = '2026-06-02'

@description('Region for the image account. MAI image models are offered in a different set of regions than the chat model, so this is deliberately independent of the resource group location.')
param imageLocation string = 'eastus'

@description('Images per minute for the image model deployment. One image takes roughly 25 seconds, so a small number here is not the bottleneck a bulk re-shoot hits first.')
param imageCapacity int = 2

@description('Name of the Foundry project created under the Azure OpenAI account. The new Foundry portal only surfaces projects, not bare accounts.')
param openAiProjectName string = 'coffee-tracker'

@allowed(['Free', 'Standard'])
@description('Static Web App SKU. Standard is required for linked backends.')
param staticWebAppSkuName string

@description('Monthly cost ceiling for this resource group, in the billing account currency, as a positive integer. Alerts only; Azure will not stop the spend.')
param monthlyBudgetAmount string = '25'

@description('Monthly cost ceiling for the Vision and OpenAI accounts alone, as a positive integer. Deliberately below the group ceiling so it trips first: AI spend is the only cost here with no upper bound of its own.')
param aiMonthlyBudgetAmount string = '15'

@description('Comma-separated addresses that receive budget alerts. Empty (the default) creates no budget at all, because a budget nobody hears from is not a control.')
param budgetContactEmails string = ''

@description('First day of the month the budgets start tracking, as yyyy-MM-01.')
param budgetStartDate string

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
  // Sync backend. Both names are well inside their limits: Cosmos allows 44
  // characters, storage accounts 24, and resourceToken is 13.
  cosmos: 'cosmos-${resourceToken}'
  photoStorage: 'stphoto${resourceToken}'
}

// Fixed names for the sync data plane. These are referenced from app settings as
// literals rather than as resource properties — see syncSettings below.
var syncDatabaseName = 'coffee'
var syncContainerName = 'sync'
var photoContainerName = 'photos'

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
// Only a bring-your-own account needs a key. The provisioned account is
// reached with the Function App's managed identity (role assignment below), so
// there is no key to store, reference, or rotate — `listKeys()` is not called
// for it at all.
var openAiUsesKey = !empty(openAiKey)
var effectiveOpenAiDeployment = empty(openAiDeployment) ? openAiModelName : openAiDeployment

// Three states, not two. An operator can point at an image resource they
// already have (`imageEndpoint`/`imageKey`/`imageDeployment`), have this
// template create one (`imageModelName`), or — the default — have neither, in
// which case studio shots stay in mock mode and nothing is billed for images.
var provisionImageAccount = empty(imageEndpoint) && !empty(imageModelName)
var effectiveImageDeployment = !empty(imageDeployment) ? imageDeployment : imageModelName
// MAI models answer on the Foundry host, not the `openai.azure.com` one the
// chat model uses: `/mai/v1/images/edits` does not exist on the latter. The
// endpoint and key come from the module rather than being composed here, so
// that a resource which may not exist is only referenced from a scope that
// deployed it. Safe-dereference because a module that did not run has no
// outputs, and ARM does not reliably short-circuit the guarding ternary.
var effectiveImageEndpoint = provisionImageAccount
  ? (imageAccount.?outputs.endpoint ?? '')
  : imageEndpoint
var effectiveImageKey = provisionImageAccount ? (imageAccount.?outputs.key ?? '') : imageKey
// Derived from parameters, not from `effectiveImageEndpoint`: this gates
// resource creation, so it has to be computable before the deployment starts.
var imageConfigured = (provisionImageAccount || !empty(imageEndpoint)) && !empty(effectiveImageDeployment)

// Both halves or neither. A token without a repository has nowhere to file,
// and a repository without a token cannot be written to, so treating either on
// its own as "configured" would produce an endpoint that accepts a person's
// words and then loses them.
var feedbackConfigured = !empty(feedbackToken) && !empty(feedbackRepo)

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
    description: 'Foundry project for the Coffee Bean Tracker BFF.'
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

// A second account, not a second deployment on the one above.
//
// MAI image models are offered in a different set of regions than the chat
// model — `eastus2`, where the rest of this stack lives, has none of them — so
// the image model cannot be a deployment on the existing account no matter how
// convenient that would be. It answers on the Foundry host under `/mai/v1`
// rather than the OpenAI-compatible `/openai/v1`, which is why the application
// reads a separate endpoint and key rather than reusing the chat resource's.
//
// Only created when asked for: the models are in preview, need capacity that is
// not available on every subscription, and each generated image is billed.
module imageAccount 'imageAccount.bicep' = if (provisionImageAccount) {
  name: 'image-account'
  params: {
    name: '${abbrev.openAi}-img'
    location: imageLocation
    tags: tags
    modelName: imageModelName
    modelVersion: imageModelVersion
    capacity: imageCapacity
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

resource openAiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (openAiUsesKey) {
  parent: keyVault
  name: 'azure-openai-key'
  properties: { value: openAiKey }
}

// Same conditional shape as the image key, and for the same reason: an empty
// secret would leave the Function App holding a Key Vault reference that
// resolves to nothing, which /api/feedback would read as "configured" and then
// fail on every submission instead of reporting itself disabled.
resource feedbackTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (feedbackConfigured) {
  parent: keyVault
  name: 'github-feedback-token'
  properties: { value: feedbackToken }
}

// Only when there is an image resource to hold a key for. Writing an empty
// secret would leave the Function App with a Key Vault reference that resolves
// to nothing, which reads as "configured" to the endpoint.
resource imageKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (imageConfigured) {
  parent: keyVault
  name: 'azure-image-key'
  properties: { value: effectiveImageKey }
}

// ---------------------------------------------------------------------------
// Sync backend: Cosmos DB (records) and Blob Storage (photo bytes)
//
// Gated on useLinkedBackend, mirroring the client's isSyncSupported() in
// src/services/platform/topology.ts. On the Free SKU the SPA calls the Function
// App cross-origin, which makes the x-ms-client-principal header attacker-
// controlled (specs/sync.md -> Identity). Sync is refused there, so provisioning
// its storage would pay for resources the security gate forbids using.
//
// COST: both are pure consumption with no idle floor. Serverless Cosmos bills
// $0.25/1M RUs and $0.25/GB-month; Hot LRS blob is $0.02/GB-month. Expected
// total for a single user is a few cents a month — see
// docs/deployment.md#what-this-costs.
// ---------------------------------------------------------------------------

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = if (useLinkedBackend) {
  name: abbrev.cosmos
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    // Serverless: no provisioned throughput, no idle cost. Individual containers
    // must not declare throughput or the deployment is rejected.
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    // Enforces "no keys in app settings" at the resource rather than by
    // convention: with local auth disabled, the connection strings and keys
    // simply do not work, so a future contributor cannot quietly reintroduce
    // them. Access is via the data-plane role assignment below.
    disableLocalAuth: true
    // Session is the correct level for this workload. The seq cursor requires a
    // client to read its own writes; it does not require other devices to see
    // them instantly, and they poll anyway.
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    minimalTlsVersion: 'Tls12'
    publicNetworkAccess: 'Enabled'
  }
}

resource syncDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = if (useLinkedBackend) {
  parent: cosmos
  name: syncDatabaseName
  properties: {
    resource: {
      id: syncDatabaseName
    }
  }
}

// One container for every record type. Partitioning on /userId puts a user's
// entire dataset in a single logical partition, which is the scope of a Cosmos
// transactional batch — and that is what allows seq to be assigned atomically
// with the records it numbers (specs/sync.md -> The seq cursor).
resource syncContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = if (useLinkedBackend) {
  parent: syncDatabase
  name: syncContainerName
  properties: {
    resource: {
      id: syncContainerName
      partitionKey: {
        paths: [
          '/userId'
        ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/seq/?'
          }
          {
            path: '/type/?'
          }
        ]
        // Payload holds whole records and is never queried by its interior
        // fields; indexing it would inflate write RUs for nothing.
        excludedPaths: [
          {
            path: '/*'
          }
        ]
      }
    }
  }
}

// A dedicated account, deliberately not the Functions runtime storage above.
// User photos and the deployment container have different lifecycles: the
// privacy commitments in SECURITY.md require deleting every byte a user owns on
// request, and that must never be able to touch the deployment package. An
// extra empty storage account has no standing charge.
resource photoStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (useLinkedBackend) {
  name: abbrev.photoStorage
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Photos are served exclusively through short-lived user-delegation SAS,
    // which is signed with Entra credentials rather than the account key.
    // Disabling key auth makes that the only possible path.
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Enabled'
  }
}

resource photoBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = if (useLinkedBackend) {
  parent: photoStorage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          // The browser PUTs photo bytes straight to blob storage with a SAS,
          // so the SPA origin must be allowed here as well as on the BFF.
          allowedOrigins: [
            'https://${staticWebApp.properties.defaultHostname}'
          ]
          allowedMethods: [
            'GET'
            'HEAD'
            'PUT'
          ]
          allowedHeaders: [
            '*'
          ]
          exposedHeaders: [
            '*'
          ]
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource photoContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = if (useLinkedBackend) {
  parent: photoBlobService
  name: photoContainerName
  properties: {
    publicAccess: 'None'
  }
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

// The key setting is present only for a bring-your-own account. Its absence is
// what selects managed identity in the BFF (see api/src/lib/openaiAuth.ts), so
// this list is the whole switch — there is no second setting to disagree with.
var openAiSettings = concat(
  [
    {
      name: 'AZURE_OPENAI_ENDPOINT'
      value: effectiveOpenAiEndpoint
    }
    {
      name: 'AZURE_OPENAI_DEPLOYMENT'
      value: effectiveOpenAiDeployment
    }
  ],
  openAiUsesKey
    ? [
        {
          name: 'AZURE_OPENAI_KEY'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/azure-openai-key/)'
        }
      ]
    : []
)

// Omitted entirely rather than set empty when no image model is available.
// `/api/studio-photo` decides between live and mock on whether these are
// present, and an empty string would be a third state neither side means.
var imageSettings = imageConfigured
  ? [
      {
        name: 'AZURE_IMAGE_ENDPOINT'
        value: effectiveImageEndpoint
      }
      {
        name: 'AZURE_IMAGE_KEY'
        value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/azure-image-key/)'
      }
      {
        name: 'AZURE_IMAGE_DEPLOYMENT'
        value: effectiveImageDeployment
      }
    ]
  : []

var feedbackSettings = feedbackConfigured
  ? [
      {
        name: 'GITHUB_FEEDBACK_REPO'
        value: feedbackRepo
      }
      {
        name: 'GITHUB_FEEDBACK_TOKEN'
        value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/github-feedback-token/)'
      }
    ]
  : []

// Every value here is a deterministic string, never a property of the
// conditional resources above. Referencing `cosmos.properties.documentEndpoint`
// from a context that also evaluates when useLinkedBackend is false is
// unreliable — ARM does not consistently short-circuit the ternary, and the
// deployment fails resolving a resource that was never deployed. The same
// hazard is documented around provisionedOpenAiEndpoint earlier in this file.
//
// The endpoint format is stable and documented, so composing it is safe.
var syncSettings = useLinkedBackend
  ? [
      {
        name: 'COSMOS_ENDPOINT'
        value: 'https://${abbrev.cosmos}.documents.azure.com:443/'
      }
      {
        name: 'COSMOS_DATABASE'
        value: syncDatabaseName
      }
      {
        name: 'COSMOS_CONTAINER'
        value: syncContainerName
      }
      {
        name: 'PHOTO_STORAGE_ACCOUNT'
        value: abbrev.photoStorage
      }
      {
        name: 'PHOTO_CONTAINER'
        value: photoContainerName
      }
      // The linked backend is the whole basis for trusting
      // x-ms-client-principal: it is set by the Static Web Apps front door, and
      // a linked Function App is not reachable any other way. This flag is what
      // the sync endpoints check before honouring the header, so that the
      // Free-tier direct-call topology — where the header is attacker-supplied
      // — refuses to serve sync rather than leaking another user's partition.
      // See specs/sync.md -> Security constraint (blocking).
      {
        name: 'SYNC_TRUSTED_PRINCIPAL_HEADER'
        value: 'true'
      }
      // Who may sync, as opposed to who is signed in. Microsoft accounts are
      // free and unlimited, so authentication alone would let anyone on the
      // internet mint a partition here and spend this subscription's RUs.
      // Empty allowlist denies everyone, including the owner — the alternative,
      // treating unconfigured as unrestricted, would open the deployment the
      // moment a parameter went missing. See specs/sync.md -> Access policy.
      {
        name: 'SYNC_ACCESS_MODE'
        value: syncAccessMode
      }
      {
        name: 'SYNC_ALLOWLIST'
        value: syncAllowlist
      }
      // Bounds the record stream. Photo *bytes* were already capped, but until
      // this reached the app the API read an env var nobody could set, so the
      // 20,000 default was effectively hard-coded. See specs/sync.md -> Quotas.
      {
        name: 'SYNC_RECORD_QUOTA'
        value: syncRecordQuota
      }
      // The Function App carries a user-assigned identity, so
      // DefaultAzureCredential has to be told which one; without this it picks
      // the system-assigned identity, which holds none of the Cosmos or blob
      // role assignments granted below.
      {
        name: 'AZURE_CLIENT_ID'
        value: functionAppIdentity.properties.clientId
      }
    ]
  : []

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
      appSettings: concat(
        baseAppSettings,
        visionSettings,
        openAiSettings,
        imageSettings,
        syncSettings,
        feedbackSettings
      )
    }
  }
  dependsOn: [
    deploymentContainer
    storageBlobDataOwner
    keyVaultSecretsUser
    // Without this the app can start, call Azure OpenAI, get a 401, and report
    // itself healthy-but-mock until something forces a restart. Unlike a missing
    // secret this failure is invisible in configuration — the setting that would
    // have been wrong no longer exists.
    openAiUser
    // The app settings resolve these by Key Vault URI at startup. Without an
    // explicit dependency the secrets can lag the app, which resolves to an
    // empty value and silently drops the BFF into mock mode.
    visionKeySecret
    openAiKeySecret
    openAiModelDeployment
    // Conditional, so this is a no-op when feedback is unconfigured; when it is
    // configured the setting is a Key Vault URI and hits the same lag as above.
    feedbackTokenSecret
    // The sync settings above name these by string, so ARM infers no
    // dependency. Without these the app can boot pointing at a Cosmos account
    // or container that does not exist yet.
    syncContainer
    photoContainer
    cosmosDataContributor
    photoBlobDataContributor
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

// Cosmos data-plane access is NOT a Microsoft.Authorization/roleAssignments.
// Control-plane RBAC grants nothing over documents; the data plane has its own
// assignment type and its own built-in role ids. Granting a control-plane role
// here would deploy cleanly and then 403 at runtime.
// 00000000-...-0002 is Cosmos DB Built-in Data Contributor.
var cosmosDataContributorRoleId = '00000000-0000-0000-0000-000000000002'

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = if (useLinkedBackend) {
  parent: cosmos
  name: guid(cosmos.id, abbrev.functionApp, cosmosDataContributorRoleId)
  properties: {
    principalId: functionAppIdentity.properties.principalId
    roleDefinitionId: resourceId(
      'Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions',
      abbrev.cosmos,
      cosmosDataContributorRoleId
    )
    scope: cosmos.id
  }
}

// Storage Blob Data Contributor on the photo account only — the BFF has no
// reason to touch the deployment account's data, which already has its own
// narrower grant above.
//
// This role already includes generateUserDelegationKey/action, verified against
// the live role definition, so it is sufficient to mint the user-delegation SAS
// that specs/sync.md requires. A separate Storage Blob Delegator assignment is
// NOT needed; please do not add one.
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource photoBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (useLinkedBackend) {
  scope: photoStorage
  name: guid(photoStorage.id, abbrev.functionApp, storageBlobDataContributorRoleId)
  properties: {
    principalId: functionAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      storageBlobDataContributorRoleId
    )
  }
}

// Cognitive Services OpenAI User — data-plane access to the model deployments,
// which is what replaces the account key. Read-only over the data plane: it can
// call the deployments but cannot create, change, or delete them, and notably
// cannot read the account keys either, so a compromise of the identity does not
// hand over a credential that outlives it.
//
// Scoped to the account rather than the resource group, so it grants nothing
// over the separate vision and image accounts.
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: openAi
  name: guid(openAi.id, abbrev.functionApp, openAiUserRoleId)
  properties: {
    principalId: functionAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
  }
}

// A user-assigned identity breaks the circular dependency between the site (which// needs its role assignments to exist first) and the role assignments (which need
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

// ---------------------------------------------------------------------------
// Cost alerting — see budget.bicep for why there are two budgets and why
// neither of them caps anything.
// ---------------------------------------------------------------------------

// The image account's id is composed rather than read back from the module.
// Referencing the outputs of a conditional module inside an array expression
// runs into the same BCP422 short-circuit problem documented in
// imageAccount.bicep; resourceId() is a pure string function and is safe to
// evaluate whether or not the account exists.
var imageAccountId = resourceId('Microsoft.CognitiveServices/accounts', '${abbrev.openAi}-img')

module budget 'budget.bicep' = if (!empty(trim(budgetContactEmails))) {
  name: 'budget'
  params: {
    resourceToken: resourceToken
    amount: int(monthlyBudgetAmount)
    aiAmount: int(aiMonthlyBudgetAmount)
    startDate: budgetStartDate
    contactEmails: budgetContactEmails
    aiResourceIds: provisionImageAccount
      ? [openAi.id, vision.id, imageAccountId]
      : [openAi.id, vision.id]
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

// Empty on Free, where sync is refused. Composed rather than read back off the
// resource for the same short-circuit reason described at syncSettings.
output cosmosAccountName string = useLinkedBackend ? abbrev.cosmos : ''
output photoStorageAccountName string = useLinkedBackend ? abbrev.photoStorage : ''
