// Kept in the host bundle: no downloaded runtime or helper installation is needed.
// Gio keeps one D-Bus connection alive through the portal request/session lifecycle.
export const WAYLAND_PORTAL_SCRIPT = String.raw`
import json
import os
import signal
import sys
import uuid
import ctypes

try:
    import gi
    gi.require_version("Gio", "2.0")
    gi.require_version("Gst", "1.0")
    from gi.repository import Gio, GLib, Gst
except (ImportError, ValueError):
    sys.exit("Wayland capture requires system Python 3 with PyGObject, Gio and GStreamer introspection (python3-gi, gir1.2-gstreamer-1.0), plus the GStreamer PipeWire and PNG plugins.")

DEST = "org.freedesktop.portal.Desktop"
ROOT = "/org/freedesktop/portal/desktop"
IFACE = "org.freedesktop.portal.ScreenCast"

class GstMetaHeader(ctypes.Structure):
    _fields_ = [("flags", ctypes.c_uint), ("info", ctypes.c_void_p)]

class VideoCropMeta(ctypes.Structure):
    _fields_ = [("meta", GstMetaHeader), ("x", ctypes.c_uint), ("y", ctypes.c_uint),
                ("width", ctypes.c_uint), ("height", ctypes.c_uint)]

def frame_crop(buffer, width, height):
    if width <= 0 or height <= 0 or width * height > 20000000:
        raise RuntimeError("PipeWire frame dimensions exceed capture limits")
    info = Gst.Meta.get_info("GstVideoCropMeta")
    meta = buffer.get_meta(info.api) if info else None
    if meta is None:
        return None
    # GstVideo introspection is not installed on every desktop. Gst.Meta is a
    # PyGObject GBoxed whose hash is its native pointer (pygboxed.c:gboxed_hash).
    # Read only the documented GstVideoCropMeta prefix while buffer/meta live.
    pointer = ctypes.c_void_p(hash(meta)).value
    if info.size < ctypes.sizeof(VideoCropMeta) or not pointer:
        raise RuntimeError("Unsupported PipeWire video crop metadata layout")
    native = VideoCropMeta.from_address(pointer)
    if native.meta.info != ctypes.c_void_p(hash(info)).value:
        raise RuntimeError("Unsupported PipeWire video crop metadata layout")
    x, y, w, h = native.x, native.y, native.width, native.height
    if w <= 0 or h <= 0 or x + w > width or y + h > height:
        raise RuntimeError("PipeWire returned an invalid window crop rectangle")
    return (x, y, w, h)

def attach_frame_crop(source, crop, source_type, on_error):
    def prepare_frame(pad, info):
        try:
            caps = pad.get_current_caps().get_structure(0)
            width, height = caps.get_value("width"), caps.get_value("height")
            region = frame_crop(info.get_buffer(), width, height)
            if source_type == 2 and region is not None:
                _x, _y, w, h = region
                # videocrop already applies the input meta's x/y offsets.
                # Only reduce the output size; setting left/top too would
                # crop the offset twice. This copies pixels, never scales.
                crop.set_property("right", width - w)
                crop.set_property("bottom", height - h)
            return Gst.PadProbeReturn.OK
        except Exception as error:
            on_error(str(error))
            return Gst.PadProbeReturn.DROP
    source.get_static_pad("src").add_probe(Gst.PadProbeType.BUFFER, prepare_frame)

class PortalCapture:
    def __init__(self, destination, source_type):
        self.destination = destination
        self.source_type = source_type
        self.connection = None
        self.session = None
        self.pending = None
        self.pipeline = None
        self.fd = None
        self.loop = GLib.MainLoop()
        self.failure = None
        self.complete = False
        self.subscriptions = []

    def stop(self, message):
        self.failure = message
        self.loop.quit()
        return GLib.SOURCE_REMOVE

    def call(self, interface, method, params, reply=None, object_path=ROOT):
        return self.connection.call_sync(DEST, object_path, interface, method, params,
            reply, Gio.DBusCallFlags.NONE, 3000, None)

    def request(self, method, signature, arguments, options):
        token = "ycrasy_" + uuid.uuid4().hex
        options = dict(options, handle_token=GLib.Variant("s", token))
        sender = self.connection.get_unique_name()[1:].replace(".", "_")
        expected = ROOT + "/request/" + sender + "/" + token
        self.pending = expected
        result = {}
        def response(_connection, _sender, _path, _interface, _signal, params):
            code, values = params.unpack()
            result.update(code=code, values=values)
            self.loop.quit()
        subscription = self.connection.signal_subscribe(DEST,
            "org.freedesktop.portal.Request", "Response", expected, None,
            Gio.DBusSignalFlags.NONE, response)
        try:
            # Subscribe before calling, so even an immediate response cannot be lost.
            handle = self.call(IFACE, method, GLib.Variant(signature, (*arguments, options))).unpack()[0]
            if handle != expected:
                self.pending = handle
                raise RuntimeError("Desktop portal returned an unexpected request handle")
            self.loop.run()
            if self.failure:
                raise RuntimeError(self.failure)
            if result.get("code") == 1:
                raise RuntimeError("Wayland capture cancelled in the desktop selector")
            if result.get("code") != 0:
                raise RuntimeError("Desktop portal refused the capture request")
            self.pending = None
            return result["values"]
        finally:
            self.connection.signal_unsubscribe(subscription)

    def capture(self):
        Gst.init(None)
        for factory in ("pipewiresrc", "videocrop", "videoconvert", "capsfilter", "pngenc", "filesink"):
            if not Gst.ElementFactory.find(factory):
                raise RuntimeError("Wayland capture requires the GStreamer plugin: " + factory)
        self.connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        props = self.call("org.freedesktop.DBus.Properties", "GetAll",
            GLib.Variant("(s)", (IFACE,))).unpack()[0]
        if props.get("version", 0) < 3:
            raise RuntimeError("Wayland capture requires ScreenCast portal version 3 or newer to verify window/monitor scope")
        if not props.get("AvailableSourceTypes", 0) & self.source_type:
            raise RuntimeError("This desktop portal cannot capture the requested source type; no whole-screen fallback is allowed")

        # Know the session path even if cancellation interrupts CreateSession's response.
        token = "ycrasy_" + uuid.uuid4().hex
        sender = self.connection.get_unique_name()[1:].replace(".", "_")
        self.session = ROOT + "/session/" + sender + "/" + token
        created = self.request("CreateSession", "(a{sv})", (), {
            "session_handle_token": GLib.Variant("s", token)})
        if created.get("session_handle") != self.session:
            self.session = created.get("session_handle") or self.session
            raise RuntimeError("Desktop portal returned an unexpected session handle")
        def closed(*_args):
            self.stop("Wayland capture session was closed by the desktop")
        self.subscriptions.append(self.connection.signal_subscribe(DEST,
            "org.freedesktop.portal.Session", "Closed", self.session, None,
            Gio.DBusSignalFlags.NONE, closed))
        options = {"types": GLib.Variant("u", self.source_type), "multiple": GLib.Variant("b", False)}
        if props.get("AvailableCursorModes", 0) & 1:
            options["cursor_mode"] = GLib.Variant("u", 1)
        if props["version"] >= 4:
            options["persist_mode"] = GLib.Variant("u", 0)
        self.request("SelectSources", "(oa{sv})", (self.session,), options)
        started = self.request("Start", "(osa{sv})", (self.session, ""), {})
        streams = started.get("streams", [])
        if len(streams) != 1 or streams[0][1].get("source_type") != self.source_type:
            raise RuntimeError("Desktop portal returned an unexpected capture source; no image was read")
        node, metadata = streams[0]
        if not isinstance(node, int) or node <= 0:
            raise RuntimeError("Desktop portal returned an invalid PipeWire stream")
        reply, fds = self.connection.call_with_unix_fd_list_sync(DEST, ROOT, IFACE,
            "OpenPipeWireRemote", GLib.Variant("(oa{sv})", (self.session, {})),
            GLib.VariantType.new("(h)"), Gio.DBusCallFlags.NONE, 3000, None, None)
        self.fd = fds.get(reply.unpack()[0])
        self.pipeline = Gst.Pipeline.new("ycrasy-single-frame")
        source = Gst.ElementFactory.make("pipewiresrc")
        source.set_property("fd", self.fd)
        # Source v6 offers stable stream serials. Older portals use the session's node id.
        serial = metadata.get("pipewire-serial")
        if serial is not None:
            if not source.find_property("target-object"):
                raise RuntimeError("GStreamer PipeWire must be updated to target this portal's stream serial")
            source.set_property("target-object", str(serial))
        else:
            source.set_property("path", str(node))
        source.set_property("num-buffers", 1)
        crop = Gst.ElementFactory.make("videocrop")
        attach_frame_crop(source, crop, self.source_type, self.stop)
        convert = Gst.ElementFactory.make("videoconvert")
        caps = Gst.ElementFactory.make("capsfilter")
        caps.set_property("caps", Gst.Caps.from_string("video/x-raw,format=RGB,width=[1,8192],height=[1,8192]"))
        encoder = Gst.ElementFactory.make("pngenc")
        encoder.set_property("snapshot", True)
        sink = Gst.ElementFactory.make("filesink")
        sink.set_property("location", self.destination)
        elements = (source, crop, convert, caps, encoder, sink)
        for element in elements:
            self.pipeline.add(element)
        for previous, following in zip(elements, elements[1:]):
            if not previous.link(following):
                raise RuntimeError("Could not link the Wayland capture pipeline")
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        def message(_bus, value):
            if value.type == Gst.MessageType.ERROR:
                error, _debug = value.parse_error()
                self.stop("PipeWire capture failed: " + error.message)
            elif value.type == Gst.MessageType.EOS:
                self.complete = True
                self.loop.quit()
        handler = bus.connect("message", message)
        frame_timeout = GLib.timeout_add_seconds(15, self.stop, "PipeWire did not deliver a capture frame")
        try:
            if self.pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                raise RuntimeError("Could not start the Wayland capture pipeline")
            self.loop.run()
            if self.failure:
                raise RuntimeError(self.failure)
            if not self.complete:
                raise RuntimeError("Wayland capture ended without a frame")
        finally:
            if GLib.MainContext.default().find_source_by_id(frame_timeout):
                GLib.source_remove(frame_timeout)
            bus.disconnect(handler)
            bus.remove_signal_watch()

    def close(self):
        if self.pipeline:
            self.pipeline.set_state(Gst.State.NULL)
        if self.fd is not None:
            os.close(self.fd)
        if self.connection:
            for subscription in self.subscriptions:
                self.connection.signal_unsubscribe(subscription)
            for path, interface in ((self.pending, "org.freedesktop.portal.Request"),
                                    (self.session, "org.freedesktop.portal.Session")):
                if path:
                    try:
                        self.connection.call_sync(DEST, path, interface, "Close", None,
                            None, Gio.DBusCallFlags.NONE, 500, None)
                    except GLib.Error:
                        pass
            self.connection.flush_sync(None)

def main():
    capture = PortalCapture(sys.argv[1], int(sys.argv[2]))
    sources = [GLib.unix_signal_add(GLib.PRIORITY_HIGH, sig, capture.stop,
        "Wayland capture cancelled") for sig in (signal.SIGTERM, signal.SIGINT)]
    deadline = GLib.timeout_add_seconds(105, capture.stop, "Desktop portal capture timed out")
    try:
        capture.capture()
        print(json.dumps({"source_type": capture.source_type}))
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        capture.close()
        for source in (*sources, deadline):
            if GLib.MainContext.default().find_source_by_id(source):
                GLib.source_remove(source)
    return 0

if __name__ == "__main__":
    sys.exit(main())
`;
