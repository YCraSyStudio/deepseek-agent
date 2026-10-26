"""Private D-Bus portal fixture; never connects to the user's desktop bus."""
import json
import signal
import sys
import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

ROOT = "/org/freedesktop/portal/desktop"
MODE = sys.argv[1]
IFACE = "org.freedesktop.portal.ScreenCast"
XML = """<node>
<interface name="org.freedesktop.DBus.Properties"><method name="GetAll">
<arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method></interface>
<interface name="org.freedesktop.portal.ScreenCast">
<method name="CreateSession"><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
<method name="SelectSources"><arg type="o" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
<method name="Start"><arg type="o" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
<method name="OpenPipeWireRemote"><arg type="o" direction="in"/><arg type="a{sv}" direction="in"/><arg type="h" direction="out"/></method>
</interface>
<interface name="org.freedesktop.portal.Request"><method name="Close"/></interface>
<interface name="org.freedesktop.portal.Session"><method name="Close"/></interface>
</node>"""

def event(**values):
    print(json.dumps(values), flush=True)

bus = Gio.TestDBus.new(Gio.TestDBusFlags.NONE)
bus.up()
connection = Gio.DBusConnection.new_for_address_sync(bus.get_bus_address(),
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
connection.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
    "RequestName", GLib.Variant("(su)", ("org.freedesktop.portal.Desktop", 0)), None,
    Gio.DBusCallFlags.NONE, 2000, None)
interfaces = {value.name: value for value in Gio.DBusNodeInfo.new_for_xml(XML).interfaces}
objects = []
loop = GLib.MainLoop()

def register(path, interface):
    objects.append(connection.register_object(path, interfaces[interface], method_call, None, None))

def method_call(_connection, sender, path, interface, method, params, invocation):
    arguments = params.unpack() if params else ()
    if method == "GetAll":
        invocation.return_value(GLib.Variant("(a{sv})", ({
            "version": GLib.Variant("u", 2 if MODE == "old" else 5),
            "AvailableSourceTypes": GLib.Variant("u", 1 if MODE == "monitor-only" else 3),
            "AvailableCursorModes": GLib.Variant("u", 1)},)))
        return
    if method == "Close":
        event(event="closed", interface=interface)
        invocation.return_value(None)
        return
    if method == "OpenPipeWireRemote":
        event(event="read-stream")
        invocation.return_dbus_error("org.freedesktop.portal.Error.Failed", "No PipeWire stream in this fixture")
        return
    options = arguments[-1]
    event(event="call", method=method, options=options)
    handle = ROOT + "/request/" + sender[1:].replace(".", "_") + "/" + options["handle_token"]
    register(handle, "org.freedesktop.portal.Request")
    result = {}
    code = 0
    if method == "CreateSession":
        session = ROOT + "/session/" + sender[1:].replace(".", "_") + "/" + options["session_handle_token"]
        register(session, "org.freedesktop.portal.Session")
        result["session_handle"] = GLib.Variant("s", session)
    elif method == "Start":
        if MODE == "wait":
            invocation.return_value(GLib.Variant("(o)", (handle,)))
            return
        if MODE == "cancel":
            code = 1
        else:
            metadata = {} if MODE == "missing-scope" else {"source_type": GLib.Variant("u", 1 if MODE == "wrong-scope" else 2)}
            streams = [(42, metadata)] * (2 if MODE == "multiple" else 1)
            result["streams"] = GLib.Variant("a(ua{sv})", streams)
    # Intentionally signal before returning the method reply to exercise the race.
    connection.emit_signal(sender, handle, "org.freedesktop.portal.Request", "Response",
        GLib.Variant("(ua{sv})", (code, result)))
    invocation.return_value(GLib.Variant("(o)", (handle,)))

register(ROOT, "org.freedesktop.DBus.Properties")
register(ROOT, IFACE)
GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, loop.quit)
event(event="ready", address=bus.get_bus_address())
try:
    loop.run()
finally:
    for object_id in objects:
        connection.unregister_object(object_id)
    connection.close_sync(None)
    bus.down()
