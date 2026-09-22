import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { archivable, bp, money, tenantColumns, ts } from './_common.js';
import { organizations, users } from './identity.js';
import { projects } from './project.js';
import { clients, contacts, vendors } from './crm.js';

export const costCodes = pgTable('cost_codes', {
  ...tenantColumns(),
  ...archivable(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => costCodes.id, { onDelete: 'set null' }),
  category: text('category'),
  defaultCostType: text('default_cost_type').notNull().default('material'),
  accountingAccountId: text('accounting_account_id'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [uniqueIndex('cost_codes_org_code_idx').on(t.organizationId, t.code)]);

export const costCatalogItems = pgTable('cost_catalog_items', {
  ...tenantColumns(),
  ...archivable(),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  unit: text('unit').notNull().default('ea'),
  unitCostCents: jsonb('unit_cost_cents').$type<Record<string, number>>().notNull().default({}),
  markupBp: jsonb('markup_bp').$type<Record<string, number>>(),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  isAllowance: boolean('is_allowance').notNull().default(false),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  sourceUrl: text('source_url'),
  searchText: text('search_text').notNull().default(''),
}, (t) => [index('cost_catalog_org_idx').on(t.organizationId, t.name)]);

export const estimateTemplates = pgTable('estimate_templates', {
  ...tenantColumns(),
  ...archivable(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  structure: jsonb('structure').notNull().default({}),
}, (t) => [index('estimate_templates_org_idx').on(t.organizationId)]);

export const estimates = pgTable('estimates', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull().default('Estimate'),
  status: text('status').notNull().default('draft'),
  defaultMarkupBp: bp('default_markup_bp'),
  markupByCostType: jsonb('markup_by_cost_type').$type<Record<string, number>>().notNull().default({}),
  taxBp: bp('tax_bp'),
  notes: text('notes').notNull().default(''),
  totals: jsonb('totals').notNull().default({}),
  lockedAt: ts('locked_at'),
  lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [index('estimates_project_idx').on(t.projectId)]);

export const estimateSections = pgTable('estimate_sections', {
  ...tenantColumns(),
  estimateId: uuid('estimate_id').notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id').references((): AnyPgColumn => estimateSections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  clientVisible: boolean('client_visible').notNull().default(true),
  totals: jsonb('totals').notNull().default({}),
}, (t) => [index('estimate_sections_estimate_idx').on(t.estimateId, t.sortOrder)]);

export const estimateLineItems = pgTable('estimate_line_items', {
  ...tenantColumns(),
  estimateId: uuid('estimate_id').notNull().references(() => estimates.id, { onDelete: 'cascade' }),
  sectionId: uuid('section_id').notNull().references(() => estimateSections.id, { onDelete: 'cascade' }),
  parentLineId: uuid('parent_line_id').references((): AnyPgColumn => estimateLineItems.id, { onDelete: 'cascade' }),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  catalogItemId: uuid('catalog_item_id').references(() => costCatalogItems.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  quantityThousandths: integer('quantity_thousandths').notNull().default(1000),
  unit: text('unit').notNull().default('ea'),
  unitCostCents: jsonb('unit_cost_cents').$type<Record<string, number>>().notNull().default({}),
  markupBp: jsonb('markup_bp').$type<Record<string, number>>(),
  taxable: boolean('taxable').notNull().default(false),
  isAllowance: boolean('is_allowance').notNull().default(false),
  isOptional: boolean('is_optional').notNull().default(false),
  included: boolean('included').notNull().default(true),
  formula: text('formula'),
  notes: text('notes').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  clientVisible: boolean('client_visible').notNull().default(true),
  totals: jsonb('totals').notNull().default({}),
}, (t) => [index('estimate_lines_estimate_idx').on(t.estimateId, t.sortOrder), index('estimate_lines_section_idx').on(t.sectionId)]);

export const proposals = pgTable('proposals', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  estimateId: uuid('estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
  number: text('number').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  validUntil: date('valid_until', { mode: 'string' }),
  introduction: text('introduction').notNull().default(''),
  terms: text('terms').notNull().default(''),
  displayOptions: jsonb('display_options').notNull().default({}),
  totalCents: money('total_cents'),
  snapshot: jsonb('snapshot'),
  releasedAt: ts('released_at'),
  decidedAt: ts('decided_at'),
  pdfDocumentId: uuid('pdf_document_id'),
}, (t) => [uniqueIndex('proposals_org_number_idx').on(t.organizationId, t.number), index('proposals_project_idx').on(t.projectId)]);

export const proposalSigners = pgTable('proposal_signers', {
  ...tenantColumns(),
  proposalId: uuid('proposal_id').notNull().references(() => proposals.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  required: boolean('required').notNull().default(true),
  signedAt: ts('signed_at'),
  signatureDocumentId: uuid('signature_document_id'),
  ipAddress: text('ip_address'),
}, (t) => [index('proposal_signers_proposal_idx').on(t.proposalId)]);

export const budgets = pgTable('budgets', {
  ...tenantColumns(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceEstimateId: uuid('source_estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('active'),
  totals: jsonb('totals').notNull().default({}),
}, (t) => [uniqueIndex('budgets_project_idx').on(t.projectId)]);

export const budgetLines = pgTable('budget_lines', {
  ...tenantColumns(),
  budgetId: uuid('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  estimateLineId: uuid('estimate_line_id').references(() => estimateLineItems.id, { onDelete: 'set null' }),
  sectionName: text('section_name').notNull().default(''),
  name: text('name').notNull(),
  originalCostCents: money('original_cost_cents'),
  originalSellCents: money('original_sell_cents'),
  projectedExtraCents: money('projected_extra_cents'),
  sortOrder: integer('sort_order').notNull().default(0),
  clientVisible: boolean('client_visible').notNull().default(false),
}, (t) => [index('budget_lines_budget_idx').on(t.budgetId, t.sortOrder), index('budget_lines_project_idx').on(t.projectId)]);

export const changeOrders = pgTable('change_orders', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  reason: text('reason'),
  status: text('status').notNull().default('draft'),
  costCents: money('cost_cents'),
  markupCents: money('markup_cents'),
  taxCents: money('tax_cents'),
  totalCents: money('total_cents'),
  scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
  sentAt: ts('sent_at'),
  viewedAt: ts('viewed_at'),
  decidedAt: ts('decided_at'),
  decisionApprovalId: uuid('decision_approval_id'),
  snapshot: jsonb('snapshot'),
  pdfDocumentId: uuid('pdf_document_id'),
  invoiceId: uuid('invoice_id'),
}, (t) => [uniqueIndex('change_orders_project_number_idx').on(t.projectId, t.number), index('change_orders_org_status_idx').on(t.organizationId, t.status)]);

export const changeOrderLines = pgTable('change_order_lines', {
  ...tenantColumns(),
  changeOrderId: uuid('change_order_id').notNull().references(() => changeOrders.id, { onDelete: 'cascade' }),
  budgetLineId: uuid('budget_line_id').references(() => budgetLines.id, { onDelete: 'set null' }),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  estimateLineId: uuid('estimate_line_id').references(() => estimateLineItems.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  quantityThousandths: integer('quantity_thousandths').notNull().default(1000),
  unit: text('unit').notNull().default('ea'),
  unitCostCents: jsonb('unit_cost_cents').$type<Record<string, number>>().notNull().default({}),
  markupBp: jsonb('markup_bp').$type<Record<string, number>>(),
  taxable: boolean('taxable').notNull().default(false),
  costCents: money('cost_cents'),
  sellCents: money('sell_cents'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('change_order_lines_co_idx').on(t.changeOrderId, t.sortOrder)]);

export const purchaseOrders = pgTable('purchase_orders', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  number: text('number').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('draft'),
  notes: text('notes').notNull().default(''),
  totalCents: money('total_cents'),
  billedCents: money('billed_cents'),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: ts('approved_at'),
  issuedAt: ts('issued_at'),
  closedAt: ts('closed_at'),
}, (t) => [uniqueIndex('purchase_orders_org_number_idx').on(t.organizationId, t.number), index('purchase_orders_project_idx').on(t.projectId)]);

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  ...tenantColumns(),
  purchaseOrderId: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  budgetLineId: uuid('budget_line_id').references(() => budgetLines.id, { onDelete: 'set null' }),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  quantityThousandths: integer('quantity_thousandths').notNull().default(1000),
  unit: text('unit').notNull().default('ea'),
  unitCostCents: money('unit_cost_cents'),
  amountCents: money('amount_cents'),
  billedCents: money('billed_cents'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('po_lines_po_idx').on(t.purchaseOrderId)]);

export const bills = pgTable('bills', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  number: text('number').notNull(),
  vendorReference: text('vendor_reference'),
  status: text('status').notNull().default('draft'),
  billDate: date('bill_date', { mode: 'string' }),
  dueDate: date('due_date', { mode: 'string' }),
  subtotalCents: money('subtotal_cents'),
  taxCents: money('tax_cents'),
  totalCents: money('total_cents'),
  paidCents: money('paid_cents'),
  notes: text('notes').notNull().default(''),
  accountingSyncId: text('accounting_sync_id'),
}, (t) => [uniqueIndex('bills_org_number_idx').on(t.organizationId, t.number), index('bills_project_idx').on(t.projectId)]);

export const billLines = pgTable('bill_lines', {
  ...tenantColumns(),
  billId: uuid('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  budgetLineId: uuid('budget_line_id').references(() => budgetLines.id, { onDelete: 'set null' }),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLines.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  amountCents: money('amount_cents'),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('bill_lines_bill_idx').on(t.billId)]);

export const invoices = pgTable('invoices', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  number: text('number').notNull(),
  title: text('title').notNull().default(''),
  billingType: text('billing_type').notNull().default('progress'),
  status: text('status').notNull().default('draft'),
  issueDate: date('issue_date', { mode: 'string' }),
  dueDate: date('due_date', { mode: 'string' }),
  subtotalCents: money('subtotal_cents'),
  taxCents: money('tax_cents'),
  retainageCents: money('retainage_cents'),
  totalCents: money('total_cents'),
  paidCents: money('paid_cents'),
  notes: text('notes').notNull().default(''),
  terms: text('terms').notNull().default(''),
  sentAt: ts('sent_at'),
  viewedAt: ts('viewed_at'),
  paidAt: ts('paid_at'),
  pdfDocumentId: uuid('pdf_document_id'),
  accountingSyncId: text('accounting_sync_id'),
}, (t) => [uniqueIndex('invoices_org_number_idx').on(t.organizationId, t.number), index('invoices_project_idx').on(t.projectId), index('invoices_org_status_idx').on(t.organizationId, t.status)]);

export const invoiceLines = pgTable('invoice_lines', {
  ...tenantColumns(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  budgetLineId: uuid('budget_line_id').references(() => budgetLines.id, { onDelete: 'set null' }),
  changeOrderId: uuid('change_order_id').references(() => changeOrders.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  quantityThousandths: integer('quantity_thousandths').notNull().default(1000),
  unitPriceCents: money('unit_price_cents'),
  amountCents: money('amount_cents'),
  percentBp: integer('percent_bp'),
  taxable: boolean('taxable').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)]);

export const payments = pgTable('payments', {
  ...tenantColumns(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  billId: uuid('bill_id').references(() => bills.id, { onDelete: 'set null' }),
  direction: text('direction').notNull().default('in'), // in = from client, out = to vendor
  method: text('method').notNull().default('other'),
  status: text('status').notNull().default('completed'),
  amountCents: money('amount_cents'),
  feeCents: money('fee_cents'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  reference: text('reference'),
  notes: text('notes').notNull().default(''),
  provider: text('provider'),
  providerPaymentId: text('provider_payment_id'),
  voidedAt: ts('voided_at'),
}, (t) => [index('payments_invoice_idx').on(t.invoiceId), index('payments_project_idx').on(t.projectId)]);

export const selections = pgTable('selections', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  estimateLineId: uuid('estimate_line_id').references(() => estimateLineItems.id, { onDelete: 'set null' }),
  budgetLineId: uuid('budget_line_id').references(() => budgetLines.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  room: text('room'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('pending'),
  allowanceCents: money('allowance_cents'),
  selectedOptionId: uuid('selected_option_id'),
  dueDate: date('due_date', { mode: 'string' }),
  releasedAt: ts('released_at'),
  decidedAt: ts('decided_at'),
  decisionApprovalId: uuid('decision_approval_id'),
  changeOrderId: uuid('change_order_id').references(() => changeOrders.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  // Standard selections sheet
  section: text('section'),
  templateKey: text('template_key'),
  areas: jsonb('areas').$type<string[]>().notNull().default([]),
  chosenAreas: jsonb('chosen_areas').$type<string[]>().notNull().default([]),
  fields: jsonb('fields').$type<string[]>().notNull().default([]),
  answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}),
  matchExisting: boolean('match_existing').notNull().default(false),
  comment: text('comment').notNull().default(''),
  defaultSpec: text('default_spec').notNull().default(''),
  byAllowance: boolean('by_allowance').notNull().default(false),
}, (t) => [index('selections_project_idx').on(t.projectId, t.sortOrder), index('selections_project_template_idx').on(t.projectId, t.templateKey)]);

/** A client's signature on the printed selections sheet (append-only). */
export const selectionSignoffs = pgTable('selection_signoffs', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  signerName: text('signer_name').notNull(),
  signatureText: text('signature_text'),
  note: text('note').notNull().default(''),
  signedByUserId: uuid('signed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  signedByContactId: uuid('signed_by_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  signedAt: ts('signed_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  decidedCount: integer('decided_count').notNull().default(0),
  snapshot: jsonb('snapshot').notNull().default({}),
}, (t) => [index('selection_signoffs_project_idx').on(t.projectId, t.signedAt)]);

export const selectionOptions = pgTable('selection_options', {
  ...tenantColumns(),
  selectionId: uuid('selection_id').notNull().references(() => selections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  manufacturer: text('manufacturer'),
  model: text('model'),
  finish: text('finish'),
  supplierVendorId: uuid('supplier_vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  costCents: money('cost_cents'),
  priceCents: money('price_cents'),
  imageDocumentId: uuid('image_document_id'),
  sourceUrl: text('source_url'),
  isRecommended: boolean('is_recommended').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('selection_options_selection_idx').on(t.selectionId)]);

export const specifications = pgTable('specifications', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  selectionId: uuid('selection_id').references(() => selections.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  room: text('room'),
  name: text('name').notNull(),
  details: jsonb('details').notNull().default({}),
  status: text('status').notNull().default('draft'),
  clientVisible: boolean('client_visible').notNull().default(true),
  vendorIds: jsonb('vendor_ids').$type<string[]>().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [index('specifications_project_idx').on(t.projectId)]);

export const bidRequests = pgTable('bid_requests', {
  ...tenantColumns(),
  ...archivable(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  scope: text('scope').notNull().default(''),
  costCodeId: uuid('cost_code_id').references(() => costCodes.id, { onDelete: 'set null' }),
  estimateLineIds: jsonb('estimate_line_ids').$type<string[]>().notNull().default([]),
  dueDate: date('due_date', { mode: 'string' }),
  status: text('status').notNull().default('draft'),
  awardedBidId: uuid('awarded_bid_id'),
}, (t) => [index('bid_requests_project_idx').on(t.projectId)]);

export const bids = pgTable('bids', {
  ...tenantColumns(),
  bidRequestId: uuid('bid_request_id').notNull().references(() => bidRequests.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('invited'),
  amountCents: money('amount_cents'),
  notes: text('notes').notNull().default(''),
  submittedAt: ts('submitted_at'),
  validUntil: date('valid_until', { mode: 'string' }),
  documentIds: jsonb('document_ids').$type<string[]>().notNull().default([]),
}, (t) => [uniqueIndex('bids_request_vendor_idx').on(t.bidRequestId, t.vendorId)]);
