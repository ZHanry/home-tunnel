//go:build darwin && cgo

package desktop

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSWindow *ht_window = nil;
static int ht_quitting = 0;

@interface HTWindowDelegate : NSObject <NSWindowDelegate>
@end

@implementation HTWindowDelegate
- (BOOL)windowShouldClose:(NSWindow *)sender {
	if (ht_quitting) {
		return YES;
	}
	[sender orderOut:nil];
	return NO;
}
@end

static HTWindowDelegate *ht_delegate = nil;

void ht_window_create(const char *url) {
	[NSApplication sharedApplication];
	[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
	NSRect frame = NSMakeRect(0, 0, 520, 820);
	ht_window = [[NSWindow alloc] initWithContentRect:frame
		styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
		backing:NSBackingStoreBuffered
		defer:NO];
	[ht_window setTitle:@"Home Tunnel"];
	[ht_window center];
	WKWebView *view = [[WKWebView alloc] initWithFrame:[[ht_window contentView] bounds]];
	view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
	[[ht_window contentView] addSubview:view];
	NSURL *nsurl = [NSURL URLWithString:[NSString stringWithUTF8String:url]];
	[view loadRequest:[NSURLRequest requestWithURL:nsurl]];
	ht_delegate = [[HTWindowDelegate alloc] init];
	[ht_window setDelegate:ht_delegate];
	[ht_window makeKeyAndOrderFront:nil];
	[NSApp activateIgnoringOtherApps:YES];
}

void ht_window_run(void) {
	[NSApp run];
}

void ht_window_show(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		if (ht_window == nil) {
			return;
		}
		[ht_window makeKeyAndOrderFront:nil];
		[NSApp activateIgnoringOtherApps:YES];
	});
}

void ht_window_quit(void) {
	ht_quitting = 1;
	dispatch_async(dispatch_get_main_queue(), ^{
		[NSApp stop:nil];
		NSEvent *event = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
			location:NSMakePoint(0, 0)
			modifierFlags:0
			timestamp:0
			windowNumber:0
			context:nil
			subtype:0
			data1:0
			data2:0];
		[NSApp postEvent:event atStart:YES];
	});
}
*/
import "C"
import "unsafe"

func createNativeWindow(url string) error {
	cstr := C.CString(url)
	defer C.free(unsafe.Pointer(cstr))
	C.ht_window_create(cstr)
	return nil
}

func runNativeWindow() {
	C.ht_window_run()
}

func showNativeWindow() {
	C.ht_window_show()
}

func quitNativeWindow() {
	C.ht_window_quit()
}
