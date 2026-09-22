/**
 * Standard selection sheets a design-build firm walks a client through before
 * construction. Applying a template to a project creates one selection per
 * item. Items can offer a single choice (tick one), areas or parts (tick all
 * that apply), and fill-in fields (paint colour, manufacturer…). Each carries
 * the builder's default specification for when the client makes no choice.
 *
 * Two templates ship:
 *  - `checklist`: the classic tick-box "Interior Selections" form.
 *  - `schematic`: the expanded "Residential Selection List" used for pricing,
 *    where most answers are written in and renovations may be "match existing".
 */
export interface SelectionTemplateItem {
  key: string;
  name: string;
  /** Pick one of these (blank for tick-all-that-apply or fill-in items). */
  choices: string[];
  /** Tick any that apply: rooms/areas the choice covers, or the parts included. */
  areas: string[];
  /** Fill-in answers, e.g. "Paint color", "Manufacturer". */
  fields: string[];
  /** Pre-ticked choice when nothing else is chosen. */
  defaultChoice: string | null;
  /** The builder's standard specification if the client makes no other choice. */
  defaultSpec: string;
  byAllowance: boolean;
  note: string;
}
export interface SelectionTemplateSection { key: string; label: string; note: string; items: SelectionTemplateItem[] }
export interface SelectionTemplate { key: string; name: string; description: string; intro: string; sections: SelectionTemplateSection[] }

const item = (key: string, name: string, o: Partial<Omit<SelectionTemplateItem, 'key' | 'name'>> = {}): SelectionTemplateItem => ({ key, name, choices: o.choices ?? [], areas: o.areas ?? [], fields: o.fields ?? [], defaultChoice: o.defaultChoice ?? null, defaultSpec: o.defaultSpec ?? '', byAllowance: o.byAllowance ?? false, note: o.note ?? '' });

const BATH_AREAS = ['Laundry', 'Lavatory', 'Master Bath', 'Bathroom(s)', 'Other'];
const CABINET_AREAS = ['Kitchen / Pantry', 'Living Room', 'Laundry', 'Master Bathroom', 'Bathroom(s)', 'Other'];
const COUNTER_AREAS = ['Kitchen / Pantry', 'Laundry', 'Master Bathroom', 'Bathroom(s)'];

/** The tick-box interior selections form. */
export const STANDARD_SELECTIONS: SelectionTemplateSection[] = [
  { key: 'flooring', label: 'Flooring', note: '', items: [
    item('flooring.wood', 'Wood floors', { choices: ['Red Oak', 'White Oak', 'Maple', 'Heart Pine', 'Mahogany'], defaultChoice: 'Red Oak', defaultSpec: '2¼" strip Red Oak. Polyurethane 3-coat finish on all wood flooring.' }),
    item('flooring.tile', 'Tile', { choices: ['Ceramic', 'Terra Cotta', 'Stone', 'Marble'], areas: BATH_AREAS, defaultSpec: 'Tile in wet areas where shown on the plans.' }),
    item('flooring.carpet', 'Carpet', { choices: ['Berber', 'Nylon'], defaultChoice: 'Nylon', defaultSpec: 'Carpet where applicable per plans.' }),
    item('flooring.vinyl', 'Vinyl', { choices: ['Sheet Vinyl', 'Luxury Vinyl Plank'] }),
  ] },
  { key: 'stairs', label: 'Stairs', note: '', items: [
    item('stairs.construction', 'Construction', { choices: ['Half-Walls', 'Buttress', 'Open'], defaultChoice: 'Open' }),
    item('stairs.treads', 'Tread material', { choices: ['Wood', 'Carpet', 'Stone', 'Tile'], defaultChoice: 'Wood', defaultSpec: 'Oak treads to match the floor; painted risers.' }),
    item('stairs.parts', 'Stair parts', { areas: ['Balusters', 'Handrails', 'Wall rails', 'Newel Posts'], defaultSpec: 'Handrail 6010 model; 4" plain square poplar newels with oak cap and band; balusters 5015 model; newels and balusters painted. Where applicable, wall rail 6010 model mounted on brackets. Basement stairs: painted treads and risers with WM231 handrail on brackets. Garage stairs framed from dimensional lumber; rises requiring it get a 42" wall with a WM231 rail on brackets.' }),
    item('stairs.terminations', 'Railing terminations', { choices: ['Rosettes', 'Half-Newels', 'Plaster return'], defaultChoice: 'Rosettes' }),
    item('stairs.finish', 'Finish', { choices: ['Painted', 'Natural / Polyurethane'], defaultChoice: 'Painted', defaultSpec: 'Newels and balusters painted; treads natural with polyurethane.' }),
  ] },
  { key: 'doors', label: 'Doors', note: 'Note door sizes on the plans.', items: [
    item('doors.interior', 'Interior wood doors', { choices: ['Raised Panel (2)', 'Raised Panel (4)', 'Raised Panel (6)', 'Flush', 'Shaker-Style'], defaultChoice: 'Raised Panel (6)', defaultSpec: 'Molded Masonite Safe ’n Sound (or equal), 6-panel design.' }),
    item('doors.french', 'French doors', { choices: ['All glass', 'Half glass', 'Custom Wood'], defaultChoice: 'All glass' }),
    item('doors.exterior', 'Exterior doors', { choices: ['Wood', 'Therma-Tru / Fiberglass'], defaultChoice: 'Therma-Tru / Fiberglass', defaultSpec: 'Exterior doors to be Therma-Tru fiberglass.' }),
    item('doors.finish', 'Door finish', { choices: ['Paint', 'Polyurethane', 'Stain & Polyurethane'], defaultChoice: 'Paint', defaultSpec: 'All doors to have a painted finish.' }),
    item('doors.hardware', 'Hardware', { areas: ['Door Knobs', 'Hinges', 'Accessories'], defaultSpec: 'Schlage Plymouth style, bright brass finish, brass-tone hinges.' }),
    item('doors.garage', 'Garage doors', { choices: ['Short panel', 'Long panel', 'Carriage style'], defaultChoice: 'Short panel', defaultSpec: 'Amarr Weather Guard, short panel design.' }),
  ] },
  { key: 'cabinetry', label: 'Cabinetry & countertops', note: 'Kitchen and bath cabinetry and countertops are by allowance. Refer to the builder’s source list for vendors and design work.', items: [
    item('cabinetry.style', 'Cabinet style', { choices: ['Beaded Inset', 'Raised Panel', 'Flat Panel', 'Glass Doors'], areas: CABINET_AREAS, byAllowance: true, defaultSpec: 'Wood cabinetry by allowance.' }),
    item('cabinetry.kitchen', 'Kitchen cabinetry features', { areas: ['Drawers', 'Large Storage', 'Accessories', 'Pull-Outs'], byAllowance: true }),
    item('cabinetry.bath', 'Bath cabinetry features', { areas: ['Drawers', 'Large Storage', 'Accessories'], byAllowance: true }),
    item('cabinetry.countertops', 'Countertop material', { choices: ['Granite', 'Marble', 'Corian', 'Staron', 'Quartz', 'Tile', 'Laminate', 'Copper', 'Stainless Steel', 'Wood'], areas: COUNTER_AREAS, byAllowance: true }),
    item('cabinetry.nosing', 'Front edge nosing', { choices: ['Rounded', 'Shaped', 'Wood', 'Tile'], defaultChoice: 'Rounded' }),
  ] },
  { key: 'plumbing', label: 'Plumbing fixtures', note: 'Plumbing fixtures are by allowance. Refer to the builder’s source list for vendors.', items: [
    item('plumbing.bathrooms', 'Bathroom(s)', { areas: ['Toilets', 'Pedestal Sink', 'Faucets', 'Tub / Shower'], byAllowance: true }),
    item('plumbing.master', 'Master bath', { areas: ['Sinks', 'Faucet(s)', 'Tub / Shower'], byAllowance: true }),
    item('plumbing.kitchen', 'Kitchen', { areas: ['Sink', 'Faucet', 'Island sink & Faucet'], byAllowance: true }),
    item('plumbing.other', 'Other', { areas: ['Outside Shower', 'Laundry sink', 'Hose bibs'], byAllowance: true }),
  ] },
  { key: 'trim', label: 'Interior finishes: trim & casing', note: '', items: [
    item('trim.woodwork', 'Woodwork', { areas: ['Baseboard', 'Chair Rail', 'Crown Molding', 'Window Casing', 'Door Casing'], defaultSpec: 'Builder’s standard casing (samples available). Baseboard 7¼" MDF speedbase on the 1st floor and 5¼" MDF speedbase on the 2nd floor.' }),
    item('trim.finish', 'Trim finish', { choices: ['Painted', 'Stained & Polyurethane'], defaultChoice: 'Painted', defaultSpec: 'All interior trim to have a painted finish.' }),
  ] },
  { key: 'fireplace', label: 'Fireplace', note: '', items: [
    item('fireplace.unit', 'Unit', { choices: ['Zero-Clearance, wood burning', 'Zero-Clearance, gas-fired', 'Masonry, wood burning', 'Masonry, gas-fired'] }),
    item('fireplace.surround', 'Opening surround', { choices: ['Fieldstone', 'Cultured Stone', 'Cut Stone', 'Brick', 'Wallboard & Plaster', 'Slate / Slate Tile', 'Marble Tile', 'Ceramic Tile', 'Soap Stone'] }),
    item('fireplace.mantle', 'Mantle', { choices: ['Wood surround to wood mantle', 'Wood mantle on brackets', 'Brick', 'Other'] }),
    item('fireplace.hearth', 'Hearth', { choices: ['Raised', 'Flush'], areas: ['Stone', 'Tile', 'Brick'] }),
  ] },
  { key: 'walls', label: 'Interior finishes: walls', note: '', items: [
    item('walls.finish', 'Walls', { choices: ['Painted', 'Wallpaper', 'Combination: paint & wallpaper'], defaultChoice: 'Painted', defaultSpec: 'Typical wall finish: skim-coat plaster and paint.' }),
    item('walls.wainscot', 'Wainscot', { choices: ['Wood', 'Tile', 'Bead Board'], areas: ['Dining', 'Hall', 'Bathroom(s)', 'Mudroom'] }),
    item('walls.paneling', 'Wood paneling finish', { choices: ['Painted', 'Stained & Polyurethane'], defaultChoice: 'Painted' }),
  ] },
  { key: 'electrical', label: 'Electrical', note: 'Estimating: fixtures and layout per the electrical plan. Final: determined by a walkthrough with the electrician.', items: [
    item('electrical.lighting', 'Lighting', { areas: ['Recessed', 'Surface Mounted', 'Under-cabinet Lighting', 'Cove Lighting'] }),
    item('electrical.special', 'Special lighting', { areas: ['Cathedral Spaces', 'Fireplace Mantels', 'Bathrooms', 'Artwork'] }),
    item('electrical.outlets', 'Outlets & low voltage', { areas: ['Computer / Network Connectivity', 'Television', 'Telephone / Fax'] }),
  ] },
  { key: 'exterior', label: 'Exterior walls & trim', note: '', items: [
    item('exterior.sidewalls', 'Sidewalls', { choices: ['HardiePlank Clapboards', 'Cedar Shingles, bleaching-oil dipped', 'Both (clapboards and shingles)'], defaultChoice: 'HardiePlank Clapboards', defaultSpec: 'HardiePlank cementitious clapboards. Wall shingles, where used, to be white cedar, bleaching-oil dipped.' }),
    item('exterior.trim', 'Trim', { choices: ['Windsor Pine', 'Azek'], defaultChoice: 'Azek', defaultSpec: 'All exterior trim components painted.' }),
    item('exterior.columns', 'Porch columns', { choices: ['Wood', 'Fiberglass'], defaultChoice: 'Fiberglass' }),
    item('exterior.railings', 'Porch & deck railings', { areas: ['Newels', 'Balusters', 'Handrails'], defaultSpec: 'Decks 30" or more off grade get mahogany handrails and balusters with square newels and caps; all components painted.' }),
  ] },
  { key: 'windows', label: 'Windows', note: 'Refer to the window schedule for sizes and final information.', items: [
    item('windows.material', 'Material', { choices: ['Wood', 'Clad: Aluminum', 'Clad: Vinyl', 'All Vinyl'], defaultChoice: 'Clad: Vinyl', defaultSpec: 'Andersen (vinyl clad, wood interior) or Harvey all-vinyl units.' }),
    item('windows.exteriorFinish', 'Exterior finish', { choices: ['Paint', 'Clad'], defaultChoice: 'Clad' }),
    item('windows.interiorFinish', 'Interior finish', { choices: ['Primed', 'Clear'], defaultChoice: 'Primed', defaultSpec: 'Primed interiors.' }),
    item('windows.trim', 'Trim', { choices: ['Factory applied', 'Custom'], defaultChoice: 'Factory applied' }),
    item('windows.grilles', 'Muntins / grilles', { choices: ['GBG (Grids Between Glass)', 'Fixed exterior / interior grid', 'Removable interior', 'SDLs (Simulated Divided Lites)', 'ADLs (Authentic Divided Lites)', 'Energy panel'], defaultChoice: 'GBG (Grids Between Glass)' }),
  ] },
  { key: 'mechanical', label: 'Mechanical', note: '', items: [
    item('mechanical.fuel', 'Heating fuel', { choices: ['Gas / Propane', 'Oil'], defaultChoice: 'Gas / Propane' }),
    item('mechanical.system', 'Heating system', { choices: ['Hot Water', 'Hydro-Air', 'Forced Hot Air'], defaultChoice: 'Forced Hot Air' }),
    item('mechanical.zones', 'Number of zones', { choices: ['1', '2', '3', '4 or more'], defaultChoice: '2' }),
    item('mechanical.ac', 'Air conditioning', { choices: ['All zones', '2nd floor only', 'None'], defaultChoice: 'All zones' }),
  ] },
];

/** The expanded, written-in "Residential Selection List" used for pricing. */
export const SCHEMATIC_SELECTIONS: SelectionTemplateSection[] = [
  { key: 'sch_exterior', label: 'Exterior (selection list)', note: '', items: [
    item('sch.roofing', 'Roofing', { choices: ['Asphalt', 'Wood'], defaultChoice: 'Asphalt', fields: ['Shingle color'], defaultSpec: '30-year architectural shingle, CertainTeed Landmark or equal; color to be decided.' }),
    item('sch.trim', 'Exterior trim', { choices: ['PVC', 'Wood'], defaultChoice: 'PVC', fields: ['Wood species (if wood)', 'Paint color'], defaultSpec: 'Azek or Kleer PVC trim or equal. Finish color white.' }),
    item('sch.siding.shingle', 'Siding: shingles', { choices: ['Bleaching oil', 'Stain', 'Unfinished'], defaultChoice: 'Bleaching oil', fields: ['Shingle type'], defaultSpec: 'Maibec white cedar shingles with bleaching oil.' }),
    item('sch.siding.clapboard', 'Siding: clapboards', { choices: ['Cementitious', 'Wood'], defaultChoice: 'Cementitious', fields: ['Paint color'], defaultSpec: 'HardiePlank cementitious clapboards, painted finish.' }),
    item('sch.doors.entry', 'Entry doors', { choices: ['Wood', 'Steel', 'Fiberglass'], defaultChoice: 'Fiberglass', fields: ['Glass / grilles', 'Paint color', 'Hardware'], defaultSpec: '36" Therma-Tru S210 with two 12" S308 sidelites at the front door. 32" Therma-Tru S262 with grilles between glass at other locations per plan.' }),
    item('sch.doors.french', 'French / sliding doors', { fields: ['Manufacturer', 'Glass / grilles', 'Paint or pre-finish', 'Paint color', 'Hardware'], defaultSpec: 'Andersen 400 Series Frenchwood doors. Grilles between glass. White exterior, white pre-finished interior, 4-9/16" extension jambs, Newbury hardware in brass finish per plans and schedules.' }),
    item('sch.doors.garage', 'Garage doors', { fields: ['Manufacturer', 'Glass / grilles', 'Paint or pre-finish', 'Paint color', 'Hardware'], defaultSpec: 'Amarr Weather Guard units, 9\'-0" x 8\'-0" or sizes shown on plan. No glass. Short panel design, white factory finish. Standard radius track and opener included.' }),
    item('sch.windows', 'Windows', { fields: ['Manufacturer', 'Glass', 'Muntins / grilles', 'Paint or pre-finish', 'Paint color', 'Hardware'], defaultSpec: 'Andersen 400 Series windows. Grilles between glass. White exterior, white pre-finished interior, 4-9/16" extension jambs, white hardware per plans and schedules. Alternative: Harvey Vicon all-vinyl units, same general specifications.' }),
    item('sch.decks', 'Decks and porches', { fields: ['Decking material', 'Handrails', 'Balusters', 'Newel posts', 'Trim material', 'Slats / lattice'], defaultSpec: '1x4 mahogany decking with mahogany handrails and 2x2 square mahogany balusters, painted finish. Deck posts pressure treated and wrapped in Azek/Kleer with matching painted post caps. Deck stairs built and finished the same way. 1x4 vertical slats and framework included, painted.' }),
  ] },
  { key: 'sch_interior', label: 'Interior (selection list)', note: '', items: [
    item('sch.fireplaces', 'Fireplaces', { choices: ['Masonry', 'Zero-clearance'], defaultChoice: 'Zero-clearance', fields: ['Fuel: wood or gas', 'Mantel design / finish', 'Hearth / surround finish'], defaultSpec: 'Vermont Castings, Heatilator or Heat & Glo (or equal) 36" gas-fired direct-vent unit. Wood mantel (samples available) and stone surround with flush hearth. Custom built-ins not included; available at extra cost.' }),
    item('sch.floors.wood', 'Floor finishes: wood', { fields: ['Species / size', 'Locations', 'Finish'], defaultSpec: '2-1/4" strip red oak at locations shown on plan, polyurethane finish.' }),
    item('sch.floors.tile', 'Floor finishes: tile', { fields: ['Tile', 'Locations'], byAllowance: true, defaultSpec: 'Ceramic tile at locations shown on plan. Subject to owner selection via allowance.' }),
    item('sch.floors.carpet', 'Floor finishes: carpet', { fields: ['Carpet', 'Locations'], byAllowance: true, defaultSpec: 'Carpet at locations shown on plan. Subject to owner selection via allowance.' }),
    item('sch.doors.interior', 'Interior doors', { choices: ['Paint', 'Stain'], defaultChoice: 'Paint', fields: ['Panel design', 'Hardware / finish'], defaultSpec: 'Masonite Safe ’n Sound or equal, 6-panel design, painted finish.' }),
    item('sch.tile.interior', 'Interior tile', { fields: ['Shower materials / location', 'Backsplash', 'Tub surrounds'], byAllowance: true, defaultSpec: 'Custom tile work not included unless specified on plan. Material by owner selection via allowance.' }),
    item('sch.stairs', 'Stairs', { choices: ['Open treads', 'Closed treads'], defaultChoice: 'Closed treads', fields: ['Tread material', 'Risers', 'Newels', 'Balusters', 'Railings', 'Finishes'], defaultSpec: 'Main stair handrail 6010 model in red oak with 5015 painted balusters; 4-1/2" square poplar newels with oak cap and band; oak treads to match flooring, painted risers and skirt. Wall railing 6010 on brackets where applicable. Basement stairs: painted treads and risers with WM231 wall railing on brackets.' }),
    item('sch.trim.special', 'Special trim', { fields: ['Wainscot / beadboard / beams'], defaultSpec: 'Special trimwork not included unless specified on plan.' }),
    item('sch.kitchen', 'Kitchen', { fields: ['Cabinetry drawings / specs (cabinetry supplier)', 'Appliance schedule (appliance supplier)'], byAllowance: true, defaultSpec: 'Kitchen and bathroom cabinetry and countertops selected by the owner with the kitchen/bath designer. Material via allowance.' }),
    item('sch.hardware', 'Misc. hardware and finishes', { fields: ['Handles, knobs, drawer pulls'], defaultSpec: 'Supplied by the owner and installed by the contractor. Recessed medicine cabinets and similar pieces are extra.' }),
    item('sch.paint', 'Interior paint', { fields: ['Wall colors / locations', 'Trim color'], defaultSpec: 'Benjamin Moore paints. Three wall colors and one trim color maximum. One coat primer, two coats finish.' }),
    item('sch.trim.interior', 'Interior trim', { fields: ['Baseboard', 'Casing', 'Crown', 'Finish'], defaultSpec: '7-1/4" MDF speedbase on the first floor, 5-1/4" on the second. 3-1/2" window and door casings from builder samples, painted. Crown moulding not included unless specified on plan.' }),
    item('sch.plumbing', 'Plumbing fixtures', { fields: ['Toilets', 'Sinks', 'Faucets', 'Tubs / showers', 'Garbage disposal'], byAllowance: true, defaultSpec: 'Plumbing fixtures selected by the owner via allowance. Custom showers not included unless specified on plan.' }),
    item('sch.electrical', 'Electrical fixtures', { fields: ['Owner-supplied fixture selections', 'Locations', 'Finishes'], defaultSpec: 'Surface-mounted fixtures (interior and exterior) supplied by the owner and installed by the electrician. Recessed fixtures per the electrical plan. Final device locations and fixture counts confirmed at the walk-through after rough framing; price adjusted on the results.' }),
  ] },
];

export const SELECTION_TEMPLATES: SelectionTemplate[] = [
  { key: 'checklist', name: 'Interior selections checklist', description: 'Tick-box form covering flooring, stairs, doors, cabinetry, plumbing, trim, fireplace, walls, electrical, exterior, windows and mechanical.', intro: 'Tick your choices in each section. Where nothing is ticked, the builder’s default applies.', sections: STANDARD_SELECTIONS },
  { key: 'schematic', name: 'Residential selection list (for pricing)', description: 'The expanded written-in list used to price and build the job, with the builder’s default for every item.', intro: 'This list shows most of the selections needed to price, build and finish your project. Please review and research these items; samples of many are available at our office and others can be had from our suppliers. Where information is missing, assumptions are made during estimating, and price or schedule changes can follow. For a renovation or addition, some items may simply be “match existing”: tell us what is matched and what changes.', sections: SCHEMATIC_SELECTIONS },
];

/** Every section in display order across all templates. */
export const ALL_SELECTION_SECTIONS: SelectionTemplateSection[] = SELECTION_TEMPLATES.flatMap((t) => t.sections);
export const SELECTION_TEMPLATE_ITEMS: SelectionTemplateItem[] = ALL_SELECTION_SECTIONS.flatMap((s) => s.items);
export function selectionTemplateItem(key: string): (SelectionTemplateItem & { section: SelectionTemplateSection }) | null {
  for (const s of ALL_SELECTION_SECTIONS) { const i = s.items.find((x) => x.key === key); if (i) return { ...i, section: s }; }
  return null;
}
