// cabinet.sud.uz (e-sud "Adolat" e-filing) config + endpoints. Reverse-engineered
// from the live Angular bundle + id.egov.uz OneID bundle (2026-08), login flow
// live-verified with BRIGHT's key. See src/lib/cabinet/oneid.ts for the flow.
export const CABINET = {
  base_url: 'https://cabinetapi.sud.uz', // main REST API
  xsud_url: 'https://cabinetapi1.sud.uz', // reception/auth (legacy path)
  host_name: 'https://cabinet.sud.uz',
} as const;

// OneID (id.egov.uz) — the e-key login provider.
export const ONEID = {
  ssoAuthorize: 'https://sso.egov.uz/sso/oauth/Authorization.do',
  api: 'https://id.egov.uz/api',
  clientId: 'exsud_sud_uz',
  redirectUri: 'https://cabinet.sud.uz/check-token',
  scope: 'exsud_sud_uz',
  state: 'testState',
  authMethod: 'PKCSMETHOD', // X-Authorization-Method header value for e-key login
} as const;

export const ENDPOINTS = {
  // Auth
  challenge: '/pkcs/testGetChallenge', // GET (ONEID.api)
  login: '/identity/auth/login', // POST {pkcs} (ONEID.api)
  ssoGenerate: '/sso/v1/generate', // POST {uuid, scope, tin} (ONEID.api)
  validateCode: '/api/validate-code', // POST {code} -> {token_id,...} (base_url)
  userGet: '/api/cabinet/user/get',

  // Claim wizard — draft
  draftCreate: '/api/cabinet/pub-user-draft-cases/create', // POST
  draftUpdate: '/api/cabinet/pub-user-draft-cases/', // PUT + {id}
  draftList: '/api/cabinet/pub-user-draft-cases/list', // GET
  draftDeleteByIds: '/api/cabinet/pub-user-draft-cases/delete-by-ids', // POST

  // Guides / manuals
  guideCategories: '/api/cabinet/guide/categories',
  guideDocumentTypes: '/api/cabinet/guide/document-types-list',
  dutyReasons: '/api/cabinet/general-manuals/duty-reasons',
  minimumWages: '/api/cabinet/general-manuals/current-minimum-wages',
  vccFee: '/api/cabinet/general-manuals/current-fee-by-type/VCC',

  // State fee (davlat boji) + invoice
  calcDuties: '/api/cabinet/case/calc-duties-by-params', // POST {..., withVCC:true}
  generateInvoices: '/api/cabinet/guide/generate-invoices', // POST
  findByReceiptNumber: '/api/cabinet/guide/find-by-receipt-number',

  // Files
  fileUpload: '/api/cabinet/case/file/upload', // POST FormData(file) + file_type GUID header

  // Existing cases
  conflictCases: '/api/cabinet/case/conflict/all-cases',
  conflictFirstMaterials: '/api/cabinet/case/conflict/first-materials',

  // Save (build the suit) — mutations
  saveSuit: '/api/cabinet/case/conflict/save-suit', // POST
  saveMaterial: '/api/cabinet/case/conflict/save-material', // POST
  saveSuitMaterial: '/api/cabinet/case/conflict/save-suit-material', // POST
  suitView: '/api/cabinet/case/conflict-suit-view/', // GET + {id}
} as const;

// ⛔ FINAL SUBMIT — irreversible. NEVER call without explicit human intent.
//   PUT /api/cabinet/case/send-to-court/{id}  body {}
export const SEND_TO_COURT_PREFIX = '/api/cabinet/case/send-to-court/';
