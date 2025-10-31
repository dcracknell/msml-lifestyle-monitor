## Simple helpers for generating the Xcode project and running tests

.PHONY: project test clean

project:
	@which xcodegen >/dev/null 2>&1 || (echo "Install XcodeGen: brew install xcodegen" && exit 1)
	cd ios && xcodegen generate

# Usage: make test SIM="iPhone 15"
SIM ?= iPhone 15
OS ?= latest

test:
	cd ios && xcodebuild -scheme MSMLLifestyleMonitor -destination "platform=iOS Simulator,name=$(SIM),OS=$(OS)" test

clean:
	rm -rf ios/MSMLLifestyleMonitor.xcodeproj
