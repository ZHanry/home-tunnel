//go:build linux && cgo

package desktop

/*
#cgo pkg-config: gtk+-3.0
#cgo !webkit2gtk4.0 pkg-config: webkit2gtk-4.1
#cgo webkit2gtk4.0 pkg-config: webkit2gtk-4.0
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <stdlib.h>

static GtkWidget *ht_window = NULL;
static int ht_quitting = 0;

static gboolean ht_on_delete(GtkWidget *widget, GdkEvent *event, gpointer data) {
	if (ht_quitting) {
		return FALSE;
	}
	gtk_widget_hide(widget);
	return TRUE;
}

static gboolean ht_present_idle(gpointer data) {
	if (ht_window == NULL) {
		return FALSE;
	}
	gtk_widget_show(ht_window);
	gtk_window_deiconify(GTK_WINDOW(ht_window));
	gtk_window_present(GTK_WINDOW(ht_window));
	return FALSE;
}

void ht_window_create(const char *url) {
	gtk_init(NULL, NULL);
	ht_window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
	gtk_window_set_title(GTK_WINDOW(ht_window), "Home Tunnel");
	gtk_window_set_default_size(GTK_WINDOW(ht_window), 520, 820);
	gtk_window_set_position(GTK_WINDOW(ht_window), GTK_WIN_POS_CENTER);
	GtkWidget *view = webkit_web_view_new();
	gtk_container_add(GTK_CONTAINER(ht_window), view);
	webkit_web_view_load_uri(WEBKIT_WEB_VIEW(view), url);
	g_signal_connect(ht_window, "delete-event", G_CALLBACK(ht_on_delete), NULL);
	gtk_widget_show_all(ht_window);
}

void ht_window_run(void) {
	gtk_main();
}

void ht_window_show(void) {
	g_idle_add(ht_present_idle, NULL);
}

void ht_window_quit(void) {
	ht_quitting = 1;
	if (gtk_main_level() > 0) {
		gtk_main_quit();
	}
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
