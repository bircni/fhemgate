var h = require('./helpers.cjs');

require('./hmccu-mappings.cjs');
require('./hmccu-accessory.cjs');
require('./hmccu-commands.cjs');

process.exit( h.summary() ? 1 : 0 );
