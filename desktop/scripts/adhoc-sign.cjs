// No Apple Developer certificate is used, but Apple Silicon still wants a valid (ad-hoc) signature on the whole bundle.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
exports.default = async (context) => {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • ad-hoc signed and verified', app);
};
