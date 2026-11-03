"""Aquatic plants, pond fish, mushrooms and companion-planting relationships (curated starter data).

Same caveats as library_plants.py: curated from general knowledge, not a citation-backed database. Companion
relationships carry an evidence level so tradition is never presented as established fact:
  documented  - supported by research or consistent extension/agronomy guidance (mechanism understood)
  mixed       - some trials or reports support it, results are inconsistent or context dependent
  traditional - gardening tradition; little or no controlled evidence
"""

# ------------------------------------------------------------------ aquatic plants
AQUATIC: list[dict] = []


def A(id, name, sci, native, zone, depth, vigour, fl, sun, notes, avoid=None, wild="", toxic=None):
    AQUATIC.append(dict(id=id, name=name, sci=sci, native=native, zone=zone, depthCm=depth, vigour=vigour, flower=fl,
                        sun=sun, notes=notes, avoid=avoid, wildlife=wild, tox=toxic))


A("hornwort", "Rigid hornwort", "Ceratophyllum demersum", "native", "oxygenating", [30, 200], "high", None, "full-part", "Rootless, free-floating oxygenator that takes up nutrients and gives cover to small animals. Thins itself if shaded.", wild="Shelter for invertebrates and fry.")
A("milfoil", "Spiked water-milfoil", "Myriophyllum spicatum", "native", "oxygenating", [50, 250], "medium", [6, 8], "full", "Submerged native oxygenator; plant in bunches in gravel. Do not confuse it with the banned parrot's feather (M. aquaticum).", wild="Cover for invertebrates.")
A("starwort", "Water-starwort", "Callitriche palustris", "native", "oxygenating", [10, 60], "medium", None, "full-part", "Fine oxygenating plant for shallow water; tolerates cool water.", wild="Cover for small invertebrates.")
A("frogbit", "European frogbit", "Hydrocharis morsus-ranae", "native", "floating", [20, 120], "medium", [7, 8], "full-part", "Floating rosettes shade the surface and take up nutrients. Declining in the wild; a good native choice.", wild="Cover for invertebrates.")
A("duckweed", "Common duckweed", "Lemna minor", "native", "floating", [10, 200], "high", None, "full-part", "Takes up nutrients quickly but can cover the whole surface in warm weather; skim off in swimming zones.")
A("whitelily", "White water-lily", "Nymphaea alba", "native", "deep", [40, 150], "medium", [6, 8], "full", "Shades the water and reduces algae; plant in baskets in 40-150 cm of water. Needs still water.", wild="Leaves shelter invertebrates; flowers visited by beetles and flies.")
A("yellowlily", "Yellow water-lily", "Nuphar lutea", "native", "deep", [50, 200], "high", [6, 8], "full-part", "Tolerates deeper, shadier and slightly moving water; vigorous - needs room.", wild="Hosts the larvae of many aquatic insects.")
A("floatingpondweed", "Broad-leaved pondweed", "Potamogeton natans", "native", "deep", [30, 150], "medium", [6, 8], "full", "Floating leaves over submerged stems; good native habitat plant for natural ponds.", wild="Food and cover for invertebrates and waterfowl.")
A("yellowflag", "Yellow flag iris", "Iris pseudacorus", "native", "marginal", [0, 30], "high", [5, 6], "full-part", "Strong filtration and root mass; vigorous and can swamp small ponds; deadhead to stop seeding.", wild="Nesting cover for water birds.", toxic="The sap irritates skin and all parts are mildly poisonous if eaten.")
A("marshmarigold", "Marsh marigold", "Caltha palustris", "native", "marginal", [0, 15], "medium", [3, 5], "full-part", "Early spring flowers for the pond edge; likes constantly wet soil.", wild="Early nectar for bees and hoverflies.", toxic="Fresh plant is mildly toxic if eaten.")
A("watermint", "Water mint", "Mentha aquatica", "native", "marginal", [0, 15], "high", [7, 9], "full-part", "Fragrant native marginal; spreads fast, so contain it.", wild="Butterflies and hoverflies feed on the flowers.")
A("arrowhead", "Arrowhead", "Sagittaria sagittifolia", "native", "shallow", [10, 40], "medium", [7, 8], "full", "Elegant emergent plant with arrow-shaped leaves; good for shallow plant zones.", wild="Cover and food for waterfowl.")
A("floweringrush", "Flowering rush", "Butomus umbellatus", "native", "shallow", [10, 40], "medium", [6, 8], "full", "Tall pink flowers; thrives in nutrient-rich water.", wild="Insects visit the flowers.")
A("forgetmenot", "Water forget-me-not", "Myosotis scorpioides", "native", "marginal", [0, 15], "medium", [5, 9], "part", "Compact blue-flowered marginal; useful on the shallow edge of the regeneration zone.", wild="Hoverflies and small bees.")
A("brooklime", "Brooklime", "Veronica beccabunga", "native", "marginal", [0, 10], "medium", [5, 8], "part", "Low creeping plant for stream and spring edges; tolerates cool, flowing water.")
A("loosestrife", "Purple loosestrife", "Lythrum salicaria", "native", "marginal", [0, 15], "high", [6, 9], "full", "Tall nectar plant, native in Romania; self-seeds. Avoid if you plan to export plants because it is invasive in North America.", wild="Excellent for bees and butterflies.")
A("alisma", "Water-plantain", "Alisma plantago-aquatica", "native", "shallow", [5, 30], "medium", [6, 9], "full-part", "Easy native emergent; good for plant filtration beds.", wild="Seeds eaten by ducks.")
A("bulrush", "Common club-rush", "Schoenoplectus lacustris", "native", "shallow", [10, 100], "high", [6, 8], "full", "Strong filtration plant for deeper edges of regeneration zones.", wild="Nesting cover.")
A("reedmace", "Lesser reedmace", "Typha angustifolia", "native", "shallow", [10, 80], "high", [6, 8], "full", "Very effective nutrient stripper but aggressive: confine it in baskets or a defined area.", wild="Cover for birds and invertebrates.")
A("reed", "Common reed", "Phragmites australis", "native", "shallow", [0, 100], "high", [7, 9], "full", "The classic wastewater-filter plant for large natural pools; extremely invasive in small ponds and can pierce liners. Only for large, well-planned areas.", wild="Habitat for reed warblers.")
A("sweetflag", "Sweet flag", "Acorus calamus", "naturalised", "marginal", [0, 25], "medium", [5, 7], "full-part", "Aromatic, scented foliage; rarely flowers in Europe. Established across Romania.")
A("elodea", "Canadian waterweed", "Elodea canadensis", "naturalised", "oxygenating", [30, 200], "high", None, "full-part", "Widely sold as an oxygenator, but it is a non-native that spreads aggressively in wild waters and can out-compete native plants.", avoid="Invasive non-native in wild waters; use native hornwort or water-starwort instead.")
A("crassula", "New Zealand pigmyweed", "Crassula helmsii", "introduced", "oxygenating", [0, 100], "high", None, "full-part", "Smothers ponds and is extremely hard to remove.", avoid="Listed as an invasive alien species of Union concern in the EU: keeping, selling and growing it is prohibited.")
A("parrotsfeather", "Parrot's feather", "Myriophyllum aquaticum", "introduced", "oxygenating", [0, 100], "high", None, "full", "Forms dense mats that choke native plants.", avoid="Listed as an invasive alien species of Union concern in the EU: keeping, selling and growing it is prohibited.")
A("waterhyacinth", "Water hyacinth", "Eichhornia crassipes", "introduced", "floating", [10, 100], "high", None, "full", "Fast-growing floating plant that can cover whole waters in warm climates.", avoid="Listed as an invasive alien species of Union concern in the EU: do not keep or release.")

# ------------------------------------------------------------------ fish
# nsp = suitability for a natural swimming pond: suitable | conditional | not_recommended | unsuitable
FISH = [
    dict(id="stickleback", name="Three-spined stickleback", sci="Gasterosteus aculeatus", native="native", nsp="suitable", lengthCm=8, tempC=[4, 25], diet="Invertebrates and larvae",
         notes="Tiny, short-lived and low impact; a good mosquito-larva eater in the regeneration zone.", warning=None),
    dict(id="rudd", name="Rudd", sci="Scardinius erythrophthalmus", native="native", nsp="conditional", lengthCm=30, tempC=[4, 28], diet="Insects, plant matter, zooplankton",
         notes="Native surface feeder. Keep numbers very low (a handful) and only in the regeneration/plant zone: it breeds freely and fish waste raises nutrients.", warning="Overstocking quickly leads to algae and murky water."),
    dict(id="tench", name="Tench", sci="Tinca tinca", native="native", nsp="conditional", lengthCm=45, tempC=[4, 28], diet="Bottom invertebrates and some plant matter",
         notes="Native, quiet and long-lived, but a bottom feeder that stirs sediment. Only in larger ponds with a soft bottom and a few individuals.", warning="Not suitable for small or shallow ponds."),
    dict(id="bitterling", name="European bitterling", sci="Rhodeus amarus", native="native", nsp="conditional", lengthCm=7, tempC=[4, 26], diet="Algae and small invertebrates",
         notes="Small and harmless to water quality, but it can only breed with live freshwater mussels (Unio/Anodonta) in the pond.", warning="Protected in the EU: never take fish from the wild; buy from a legal breeder and check local rules."),
    dict(id="minnow", name="Common minnow", sci="Phoxinus phoxinus", native="native", nsp="conditional", lengthCm=9, tempC=[2, 22], diet="Insect larvae and zooplankton",
         notes="Needs cool, well-oxygenated, preferably flowing water. A stream or waterfall section helps; warm summer water kills it.", warning="Sensitive to warm, still water."),
    dict(id="goldfish", name="Goldfish", sci="Carassius auratus", native="introduced", nsp="not_recommended", lengthCm=30, tempC=[2, 30], diet="Omnivore, grazes on bottom and plants",
         notes="Non-native, breeds explosively and eats the zooplankton that keep algae in check.", warning="Not recommended; never release into natural waters."),
    dict(id="koi", name="Koi / ornamental carp", sci="Cyprinus carpio (koi)", native="introduced", nsp="unsuitable", lengthCm=80, tempC=[4, 30], diet="Omnivore, digs in sediment",
         notes="Large bottom feeders that uproot plants, stir sediment and add heavy nutrient loads; designed for mechanically filtered koi ponds, not natural swimming ponds.", warning="Unsuitable for natural swimming ponds."),
    dict(id="carp", name="Common carp", sci="Cyprinus carpio", native="native", nsp="unsuitable", lengthCm=80, tempC=[2, 30], diet="Omnivore, digs in sediment",
         notes="Native in the Danube basin but its feeding style destroys plant beds and clouds the water.", warning="Unsuitable for swimming ponds."),
    dict(id="grasscarp", name="Grass carp", sci="Ctenopharyngodon idella", native="introduced", nsp="unsuitable", lengthCm=100, tempC=[4, 30], diet="Eats aquatic plants",
         notes="Strips the filtration plants a natural pond relies on and grows very large.", warning="Non-native with restrictions on keeping and release; do not use."),
    dict(id="gambusia", name="Mosquitofish", sci="Gambusia holbrooki", native="introduced", nsp="unsuitable", lengthCm=5, tempC=[8, 35], diet="Insects, eggs and fry of other species",
         notes="Invasive in Europe where it displaces native fish and amphibians.", warning="Invasive: never introduce."),
]

WATER_QUALITY = {
    "note": "General guidance only. Species, season and local rules vary; swimming-pond designers also track phosphorus, which this log does not.",
    "ranges": {
        "tempC": {"label": "Temperature", "unit": "°C", "warnAbove": 28, "note": "Above ~28 °C oxygen drops and algae grow fast."},
        "ph": {"label": "pH", "unit": "", "min": 6.5, "max": 8.5},
        "oxygen": {"label": "Dissolved oxygen", "unit": "mg/L", "min": 5, "note": "Below ~5 mg/L fish become stressed."},
        "ammonia": {"label": "Ammonia (total)", "unit": "mg/L", "max": 0.25, "note": "Ideally near zero; toxicity rises with pH and temperature."},
        "nitrite": {"label": "Nitrite", "unit": "mg/L", "max": 0.1, "note": "Ideally near zero."},
        "nitrate": {"label": "Nitrate", "unit": "mg/L", "max": 25, "note": "Persistently high nitrate feeds algae."},
    },
}

# ------------------------------------------------------------------ mushrooms
# status: edible | edible_cooked | inedible | poisonous | deadly. Photos are deliberately not bundled.
MUSHROOMS: list[dict] = []


def M(id, name, sci, status, season, habitat, substrate, look, warn, cult="none", cult_note="", ro=None):
    MUSHROOMS.append(dict(id=id, name=name, ro=ro, sci=sci, status=status, season=season, habitat=habitat, substrate=substrate,
                          lookalikes=look, warning=warn, cultivation=cult, cultivationNote=cult_note))


M("chanterelle", "Chanterelle", "Cantharellus cibarius", "edible", [6, 10], "Beech, oak and spruce woodland, mossy ground", "Soil (mycorrhizal)", "Jack-o'-lantern (Omphalotus olearius) grows in clusters on wood and is poisonous; false chanterelle (Hygrophoropsis aurantiaca) is much less fragrant with true gills instead of ridges.", "Check for blunt forked ridges (not true gills) and an apricot smell. Cook thoroughly.", ro="Gălbiori")
M("porcini", "Porcini / penny bun", "Boletus edulis", "edible", [6, 11], "Spruce, beech and oak woods", "Soil (mycorrhizal)", "Bitter bolete (Tylopilus felleus) is inedibly bitter; Satan's bolete (Rubroboletus satanas) is poisonous. Red pores or flesh that quickly turns blue are warning signs.", "Never eat a bolete with red pores, strongly bluing flesh, or a bitter taste.", ro="Hrib")
M("parasol", "Parasol mushroom", "Macrolepiota procera", "edible", [7, 10], "Grassland and woodland edges", "Soil", "Small Lepiota species (some deadly) and young Amanitas look similar to small parasols.", "Only pick large specimens with a snakeskin-patterned stem and a movable double ring; eat caps only and cook them.", ro="Pălăria șarpelui")
M("honeyfungus", "Honey fungus", "Armillaria mellea agg.", "edible_cooked", [9, 11], "Dense clusters at tree bases and stumps", "Living and dead wood", "Deadly Galerina marginata can grow on the same logs and looks similar in autumn.", "Must be well cooked (it upsets many people raw or undercooked). Check for a spore print: white for honey fungus, rusty-brown for deadly Galerina.")
M("morel", "Morel", "Morchella esculenta agg.", "edible_cooked", [3, 5], "Orchards, riverbanks, burnt ground, ash woods", "Soil", "False morels (Gyromitra esculenta) are deadly poisonous when raw; true morels are completely hollow when sliced lengthwise.", "NEVER eat raw or undercooked. Slice every one lengthwise to check it is hollow with the cap fused to the stem.")
M("oyster", "Oyster mushroom", "Pleurotus ostreatus", "edible", [10, 12], "Dead and dying hardwood (beech, poplar)", "Hardwood, straw", "Poisonous Omphalotus species can resemble it; check for a lilac-grey to cream shelf with a lateral stem.", "Cook before eating.", cult="easy", cult_note="The easiest mushroom to grow at home: straw, sawdust or logs, kept moist in a shaded spot or on a shelf in a cool shed.")
M("shiitake", "Shiitake", "Lentinula edodes", "edible", [4, 11], "Cultivated on hardwood logs (oak, beech, hornbeam)", "Hardwood logs, sawdust", "Few; cultivated from known spawn.", "Cook; raw can cause skin rash in some people.", cult="moderate", cult_note="Inoculate freshly cut oak or beech logs with plug spawn in spring, then wait 6-12 months for the first flush.")
M("lionsmane", "Lion's mane", "Hericium erinaceus", "edible", [8, 11], "Hardwood trunks, mainly beech", "Hardwood logs, sawdust", "Very distinctive; other Hericium species are also edible.", "Collect only fresh, white specimens; cook.", cult="moderate", cult_note="Grows on logs or supplemented sawdust blocks; prefers cool damp air.")
M("winecap", "Wine cap / garden giant", "Stropharia rugosoannulata", "edible", [5, 10], "Wood-chip garden beds", "Fresh hardwood chips", "Check spore colour (purple-brown) and ring; some brown-capped woodland species are poisonous.", "Cook; eat only specimens you grew from known spawn.", cult="easy", cult_note="Easy outdoor crop in a 10 cm layer of fresh wood chips in a shady bed; can be interplanted among garden beds.")
M("button", "Button / cultivated mushroom", "Agaricus bisporus", "edible", [1, 12], "Cultivated on composted manure", "Composted straw and manure", "Not applicable (cultivated).", "Buy spawn or kits from a reputable supplier.", cult="moderate", cult_note="Needs pasteurised compost and cool, humid, dark conditions: a kit is the practical route.")
M("fieldmushroom", "Field mushroom", "Agaricus campestris", "edible", [8, 10], "Old pasture and lawns", "Soil", "Yellow stainer (Agaricus xanthodermus) is poisonous; white Amanitas (death cap, destroying angel) are DEADLY and can look similar when young.", "Only for experienced foragers: gills must go from pink to chocolate-brown, with no cup at the base and no white gills.")
M("chickenwoods", "Chicken of the woods", "Laetiporus sulphureus", "edible_cooked", [5, 10], "Oak, cherry, willow and yew trunks", "Living and dead hardwood", "Few, but specimens growing on conifers or yew can cause illness.", "Cook thoroughly and try a small amount first; some people react. Avoid specimens from conifers and yew.")
M("shaggymane", "Shaggy ink cap", "Coprinus comatus", "edible", [8, 11], "Lawns, roadsides, disturbed ground", "Soil", "Do not confuse with common ink cap (Coprinopsis atramentaria), which is poisonous with alcohol.", "Eat young specimens, cooked within hours of picking, before they turn black.")
M("saffronmilkcap", "Saffron milk cap", "Lactarius deliciosus", "edible", [7, 10], "Pine and spruce woods", "Soil (mycorrhizal)", "Some other milk caps are irritant when eaten; check for orange carrot milk that turns green.", "Cook; must have orange latex and green staining.")
M("deathcap", "Death cap", "Amanita phalloides", "deadly", [7, 11], "Oak, beech and hornbeam woodland", "Soil (mycorrhizal)", "Resembles edible green-capped Russulas, young puffballs, paddy straw mushrooms and field mushrooms.", "DEADLY. Responsible for most fatal mushroom poisonings in Europe. Symptoms appear 6-24 hours after eating, when liver damage has already begun. Seek emergency care immediately.", ro="Burete viperei")
M("destroyingangel", "Destroying angel", "Amanita virosa", "deadly", [7, 10], "Acid woodland", "Soil (mycorrhizal)", "Pure white; can be mistaken for field mushrooms, parasols and white puffballs.", "DEADLY. Do not collect any white gilled mushroom with a ring and a cup at the base.")
M("galerina", "Funeral bell", "Galerina marginata", "deadly", [4, 11], "Rotting wood, stumps", "Dead wood", "Looks like honey fungus, sulphur tuft and other small brown woodland mushrooms.", "DEADLY (same toxins as death cap). Never collect small brown mushrooms from wood unless you can identify them with certainty.")
M("orellanus", "Deadly webcap", "Cortinarius orellanus", "deadly", [8, 11], "Oak and beech woodland on acid soil", "Soil (mycorrhizal)", "Resembles edible chanterelles and other orange-brown woodland mushrooms.", "DEADLY: causes kidney failure, with symptoms delayed for up to 2 weeks.")
M("falsemorel", "False morel", "Gyromitra esculenta", "deadly", [3, 6], "Sandy pine woodland", "Soil", "Resembles true morels but is brain-like and not hollow.", "DEADLY when raw and still harmful if cooked (gyromitrin). Do not eat.")
M("flyagaric", "Fly agaric", "Amanita muscaria", "poisonous", [7, 11], "Birch, spruce and pine woods", "Soil (mycorrhizal)", "Red-capped with white flecks; caps can fade to orange.", "POISONOUS (hallucinogenic and toxic effects). Do not eat. Dangerous to children and dogs.")
M("panthercap", "Panther cap", "Amanita pantherina", "poisonous", [7, 10], "Beech and spruce woods", "Soil (mycorrhizal)", "Can be mistaken for the edible blusher (Amanita rubescens), which also is only safe when well cooked.", "POISONOUS. Do not eat.")
M("inkycap", "Common ink cap", "Coprinopsis atramentaria", "poisonous", [4, 11], "Lawns, wood waste, gardens", "Buried wood", "Resembles shaggy ink cap.", "Toxic with alcohol (taken within days): causes flushing, palpitations and nausea.")
M("rollrim", "Brown roll-rim", "Paxillus involutus", "poisonous", [6, 11], "Birch, spruce and pine woods", "Soil (mycorrhizal)", "Looks like other brown, mild-looking boletes and webcaps.", "POISONOUS: was eaten in the past but causes a potentially fatal immune reaction after repeated meals.")
M("livident", "Livid entoloma", "Entoloma sinuatum", "poisonous", [5, 10], "Oak and beech woods, parks, gardens", "Soil (mycorrhizal)", "Resembles edible field mushrooms and some tricholomas.", "POISONOUS: a leading cause of serious gastric poisoning in Europe.")
M("jackolantern", "Jack-o'-lantern", "Omphalotus olearius", "poisonous", [8, 11], "Stumps and roots of oak and olive", "Hardwood", "Often mistaken for chanterelles.", "POISONOUS: severe stomach cramps and vomiting.")
M("sulphurtuft", "Sulphur tuft", "Hypholoma fasciculare", "poisonous", [3, 12], "Dead wood, all year", "Dead wood", "Resembles honey fungus and edible woodland tufts.", "POISONOUS (can be dangerous). Do not eat.")

# ------------------------------------------------------------------ companion planting
# type: beneficial | pest | nutrient | compatible | conditional | incompatible
COMPANIONS: list[dict] = []


def C(a, b, kind, evidence, note):
    COMPANIONS.append(dict(a=a, b=b, type=kind, evidence=evidence, note=note))


C("tomato", "marigold", "pest", "documented", "Dense French marigold (Tagetes patula) is documented to suppress root-knot nematodes in the soil. It does not reliably repel above-ground pests, and the effect needs a dense planting grown for a full season.")
C("tomato", "basil", "compatible", "traditional", "A very popular pairing: same sun and water needs and they cook well together. Claims of better flavour or fewer pests have little controlled evidence.")
C("tomato", "borage", "beneficial", "mixed", "Borage flowers attract bees and may improve fruit set; the pest-deterrent claims are unproven.")
C("tomato", "calendula", "beneficial", "mixed", "Calendula is a long-flowering insectary plant that supports hoverflies and parasitic wasps that feed on aphids.")
C("tomato", "carrot", "compatible", "traditional", "Traditionally grown together; they use different soil depths. No strong evidence for mutual benefit.")
C("tomato", "garlic", "pest", "traditional", "Alliums are traditionally grown among tomatoes to deter spider mites and aphids; evidence is anecdotal.")
C("tomato", "potato", "incompatible", "documented", "Same family (Solanaceae) sharing late blight (Phytophthora infestans), early blight and Colorado beetle: growing them side by side or in succession increases disease risk.")
C("tomato", "pepper", "conditional", "documented", "Same family: they share diseases, so rotate them and avoid planting where either grew last year. They need the same warm, rich conditions.")
C("tomato", "fennel", "incompatible", "mixed", "Fennel releases compounds that inhibit the growth of many neighbours in laboratory tests; field effects are variable, but most gardeners keep it apart from the vegetable beds.")
C("tomato", "dill", "conditional", "traditional", "Young dill is said to attract beneficial insects; mature dill is said to stunt tomatoes. Evidence is anecdotal; grow it a few metres away to be safe.")
C("tomato", "sweetcorn", "conditional", "documented", "Corn earworm / tomato fruitworm (Helicoverpa) attacks both crops, so growing them together can concentrate the pest.")
C("tomato", "walnut", "incompatible", "documented", "Walnut roots and leaf litter release juglone, which wilts tomatoes and other Solanaceae. Effects are strongest within the root zone, and strongest of all for black walnut (J. nigra); common walnut (J. regia) produces less but still enough to avoid.")
C("potato", "walnut", "incompatible", "documented", "Potato is sensitive to juglone: keep potatoes well beyond the root zone and drip line of walnut trees.")
C("apple", "walnut", "incompatible", "mixed", "Apple is on lists of juglone-sensitive plants, although field reports vary and the effect is much better documented for black walnut. Plant well away.")
C("carrot", "onion", "pest", "mixed", "Intercropping alliums with carrots has reduced carrot-fly damage in some trials; results are inconsistent and depend on planting pattern.")
C("carrot", "leek", "pest", "mixed", "Leeks and onions mask carrot scent from carrot fly in some trials; effect varies between seasons.")
C("carrot", "sage", "pest", "traditional", "Strong-smelling herbs are traditionally grown near carrots to confuse carrot fly; little controlled evidence.")
C("carrot", "dill", "conditional", "traditional", "Both are Apiaceae and share pests. Dill's flowers attract helpful insects, but mature dill is said to reduce carrot yields: keep it a bed away.")
C("cabbage", "dill", "beneficial", "mixed", "Flowering umbellifers such as dill attract hoverflies and parasitic wasps that prey on cabbage pests. Overall pest reduction is variable.")
C("cabbage", "nasturtium", "pest", "mixed", "Nasturtium is used as a trap crop for cabbage white butterflies and aphids; it can also simply host more of them, so watch it.")
C("cabbage", "thyme", "pest", "traditional", "Aromatic herbs are traditionally interplanted with brassicas to disrupt egg-laying pests; controlled evidence is limited.")
C("cabbage", "mint", "pest", "mixed", "Mint is said to deter cabbage white butterflies. It spreads aggressively: grow it in a sunk pot.")
C("cabbage", "garlic", "pest", "traditional", "Alliums are traditionally interplanted with brassicas; evidence is anecdotal.")
C("bean", "onion", "incompatible", "traditional", "Alliums are traditionally kept away from beans and peas, said to inhibit growth. Evidence is anecdotal.")
C("bean", "garlic", "incompatible", "traditional", "Same traditional advice as onion: keep alliums away from legumes.")
C("pea", "onion", "incompatible", "traditional", "Traditionally kept apart; evidence is anecdotal.")
C("pea", "garlic", "incompatible", "traditional", "Traditionally kept apart; evidence is anecdotal.")
C("bean", "fennel", "incompatible", "traditional", "Fennel is widely advised to be kept away from most garden crops, beans included.")
C("bean", "potato", "beneficial", "traditional", "Beans are traditionally said to deter Colorado beetle from potatoes, but trial evidence is thin.")
C("bean", "sweetcorn", "beneficial", "documented", "Intercropping a climbing bean with maize is a long-established system: the bean fixes nitrogen and uses the stalk as support, and the mixed crop uses land more efficiently than separate crops.")
C("sweetcorn", "pumpkin", "beneficial", "documented", "Part of the traditional 'three sisters' system: squash leaves shade the soil, suppressing weeds and holding moisture.")
C("bean", "pumpkin", "beneficial", "documented", "Part of the three sisters system with maize: legume nitrogen, ground cover from squash.")
C("cucumber", "dill", "beneficial", "mixed", "Dill flowers attract beneficial insects; it is also a classic pairing in the kitchen.")
C("cucumber", "nasturtium", "pest", "traditional", "Traditionally planted to lure aphids and cucumber beetles; evidence is mostly anecdotal.")
C("lettuce", "radish", "compatible", "traditional", "Fast radish marks the row and is harvested before lettuce needs the space.")
C("strawberry", "borage", "beneficial", "traditional", "Borage attracts pollinators and is traditionally said to improve strawberry yield; evidence is anecdotal.")
C("sunflower", "potato", "incompatible", "mixed", "Sunflower produces allelopathic compounds that inhibit some neighbours in lab tests; field effects vary.")
C("sunflower", "bean", "incompatible", "mixed", "Allelopathic effects of sunflower on beans are reported in some studies and not others.")
C("fennel", "dill", "conditional", "documented", "Fennel and dill are close relatives and cross-pollinate: if you save seed, grow them well apart.")
C("chives", "apple", "beneficial", "traditional", "Chives under apple trees are traditionally said to reduce apple scab and aphids; there is limited evidence, but they are a good low-growing flowering groundcover for bees.")
C("nasturtium", "apple", "pest", "traditional", "Traditionally grown at the foot of fruit trees to attract aphids away; unproven.")
C("comfrey", "apple", "nutrient", "mixed", "Comfrey leaves are rich in potassium; cut as a mulch around trees they return nutrients to the soil. The trees do not draw directly on the comfrey. Use the sterile 'Bocking 14' type so it does not spread.")
C("comfrey", "pear", "nutrient", "mixed", "Comfrey leaf mulch supplies potassium (see apple).")
C("comfrey", "plum", "nutrient", "mixed", "Comfrey leaf mulch supplies potassium (see apple).")
C("comfrey", "cherry", "nutrient", "mixed", "Comfrey leaf mulch supplies potassium (see apple).")
C("lavender", "rosemary", "compatible", "documented", "Both need full sun, lean soil and sharp drainage, so they thrive together. Both flower for bees.")
C("lavender", "thyme", "compatible", "documented", "Same dry Mediterranean conditions; a classic pollinator planting.")
C("sage", "rosemary", "compatible", "documented", "Same dry, sunny, free-draining conditions.")
C("mint", "tomato", "conditional", "traditional", "Mint is said to deter some pests but takes over a bed in a season: plant in a pot or a sunk container.")
