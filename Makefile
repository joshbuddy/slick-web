test: test-unit

test-unit:
	NODE_ENV=test ./node_modules/.bin/mocha -R spec test/helpers/node.js \
		test/unit/**/*_test.js test/unit/*_test.js \
		-g '${TEST}'

