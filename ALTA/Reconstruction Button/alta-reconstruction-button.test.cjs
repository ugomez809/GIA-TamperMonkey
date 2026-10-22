const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(`${__dirname}/alta-reconstruction-button.user.js`, 'utf8');
const lookupSource = source.slice(0, source.indexOf('    let syncScheduled = false;')) +
    'globalThis.lookup = getReconstructionLookup; })();';

function setup(appStore) {
    const storage = new Map([['appStore', appStore]]);
    const context = {
        URLSearchParams,
        document: { querySelectorAll: () => [] },
        window: {
            location: { pathname: '/quote/home/replacement-cost', href: 'https://alta.farmers.com/quote/home/replacement-cost' },
            sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
        }
    };
    vm.runInNewContext(lookupSource, context);
    return { context, storage };
}

const quote = (zipCode = '90210', sqFeet = '2,100') => JSON.stringify({
    home: { addressForm: { fields: [{ zipCode }] }, propertyForm: { fields: [{ sqFeet }] } }
});

test('Customer info → replacement cost works without Home Features or a lookup cache', () => {
    const { context } = setup(quote());
    assert.equal(context.lookup(null).url, 'https://gomezagency.net/zipcodes.html?zipcode=90210&squareFootage=2100');
});

test('reads current stored values again instead of reusing an earlier quote', () => {
    const { context, storage } = setup(quote());
    context.lookup(null);
    storage.set('appStore', quote('90210', '1800'));
    assert.equal(context.lookup(null).squareFootage.value, '1800');
});

test('missing, malformed, or invalid stored data cannot create a calculator URL', () => {
    for (const data of [undefined, '{bad', 'null', '{}', quote('bad', '2100'), quote('90210', '0')]) {
        assert.equal(setup(data).context.lookup(null).url, null);
    }
});

test('blocked storage is handled without throwing', () => {
    const { context } = setup(quote());
    context.window.sessionStorage.getItem = () => { throw new Error('blocked'); };
    assert.equal(context.lookup(null).url, null);
});

test('stored square footage takes precedence over page square footage', () => {
    const { context } = setup(quote());
    const input = { value: '2400', getAttribute: key => key === 'aria-label' ? 'Square feet' : null };
    context.document.querySelectorAll = selector => selector === '[data-test-id="LIVABLE_SQUARE_FEET_INPUT"]' ? [input] : [];
    assert.equal(context.lookup(null).squareFootage.value, '2100');
});

test('stored ZIP takes precedence over page address', () => {
    const { context } = setup(quote());
    const address = { value: 'Example, CA 10001', getAttribute: () => null };
    context.document.querySelectorAll = selector => selector === '.titleAndAddress .address-line' ? [address] : [];
    assert.equal(context.lookup(null).url, 'https://gomezagency.net/zipcodes.html?zipcode=90210&squareFootage=2100');
});

test('page fields remain a fallback when stored quote data is missing', () => {
    const { context } = setup('{}');
    const address = { value: 'Example, CA 10001', getAttribute: () => null };
    const input = { value: '2400', getAttribute: key => key === 'aria-label' ? 'Square feet' : null };
    context.document.querySelectorAll = selector => {
        if (selector === '.titleAndAddress .address-line') return [address];
        if (selector === '[data-test-id="LIVABLE_SQUARE_FEET_INPUT"]') return [input];
        return [];
    };
    assert.equal(context.lookup(null).url, 'https://gomezagency.net/zipcodes.html?zipcode=10001&squareFootage=2400');
});
