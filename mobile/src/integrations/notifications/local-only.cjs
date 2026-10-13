const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = (config) =>
  withEntitlementsPlist(config, (result) => {
    delete result.modResults['aps-environment'];
    return result;
  });
