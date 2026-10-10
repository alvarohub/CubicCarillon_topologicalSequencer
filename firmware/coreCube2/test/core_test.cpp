#include "core/sequencer.hpp"
#include "commands.hpp"
#include "presentation.hpp"
#include "demo.hpp"
#include "adapters/panel_mapping.hpp"
#include "adapters/serial_protocol.hpp"
#include "adapters/session_codec.hpp"
#include <cassert>
#include <iostream>
#include <vector>

using namespace topo;

static void record(void* context, const Event& event) {
  static_cast<std::vector<Event>*>(context)->push_back(event);
}

static void run(Sequencer& instrument, double seconds, double interval, std::vector<Event>& events) {
  instrument.setPaused(false);
  const unsigned steps = static_cast<unsigned>(std::round(seconds / interval));
  for (unsigned step = 0; step < steps; ++step) instrument.update(interval, record, &events);
}

static void near(double actual, double expected) { assert(std::abs(actual - expected) < 1e-7); }

int main(int argc, char**) {
  if (argc > 1) {
    const Surface surface = cubeSurface(8);
    for (unsigned face = 0; face < 6; ++face) {
      for (const Edge& edge : surface.edges[face]) {
        std::cout << unsigned(edge.face) << ' ' << int(edge.xx) << ' ' << int(edge.xy) << ' '
                  << int(edge.yx) << ' ' << int(edge.yy) << ' ' << edge.tx << ' ' << edge.ty << '\n';
      }
    }
    return 0;
  }

  Sequencer instrument;
  Sequence reader;
  reader.pose = {0, 0.5, 3.5, 1, 0};
  reader.rate = 1;
  assert(instrument.addSequence(reader) == 0);
  assert(instrument.setTempo(60));
  std::vector<Event> events;
  run(instrument, 32, 0.01, events);
  assert(instrument.sequence(0).pose.face == 0);
  near(instrument.sequence(0).pose.x, 0.5);
  near(instrument.sequence(0).pose.y, 3.5);
  near(instrument.sequence(0).pose.dx, 1);
  assert(events.size() == 32);

  Band band;
  assert(instrument.addBand(band) == 0);
  reader.band = 0;
  reader.degree = 6;
  reader.pose = {4, 2.1, 3.2, 1, 0.37};
  assert(instrument.addSequence(reader) == 1);
  assert(instrument.pitch(1) == 74);
  const Pose before = instrument.sequence(1).pose;
  band.tonic = 62;
  assert(instrument.setBand(0, band));
  assert(instrument.pitch(1) == 76);
  near(instrument.sequence(1).pose.x, before.x);
  near(instrument.sequence(1).pose.dy, before.dy);
  for (unsigned index = 1; index < maxBands; ++index) assert(instrument.addBand(band) == int(index));
  assert(instrument.addBand(band) == -1);
  assert(instrument.bandCount() > 3);

  Sequencer fine, coarse;
  reader.band = -1;
  reader.rate = 4;
  assert(fine.addSequence(reader) == 0 && coarse.addSequence(reader) == 0);
  std::vector<Event> fineEvents, coarseEvents;
  run(fine, 10, 0.005, fineEvents);
  run(coarse, 10, 0.025, coarseEvents);
  assert(fineEvents.size() == coarseEvents.size());
  assert(fineEvents.size() > 80);
  for (unsigned index = 0; index < fineEvents.size(); ++index) {
    assert(fineEvents[index].kind == coarseEvents[index].kind);
    assert(fineEvents[index].cell == coarseEvents[index].cell);
    near(fineEvents[index].time, coarseEvents[index].time);
  }
  near(std::hypot(fine.sequence(0).pose.dx, fine.sequence(0).pose.dy), 1);
  assert(fine.overruns() == 0);

  Sequencer torus(torusSurface());
  reader.pose = {0, 0.5, 0.5, 1, 0};
  reader.rate = 1;
  assert(torus.addSequence(reader) == 0);
  torus.setTempo(60);
  torus.setCell({0, 1, 0}, 100);
  events.clear();
  run(torus, 8, 0.01, events);
  near(torus.sequence(0).pose.x, 0.5);
  unsigned notes = 0;
  for (const Event& event : events) if (event.kind == EventKind::Note) {
    ++notes;
    assert(event.note == 60 && event.velocity == 100);
    near(event.time, 0.5);
  }
  assert(notes == 1);
  torus.setSequenceMuted(0, true);
  events.clear();
  run(torus, 8, 0.01, events);
  for (const Event& event : events) assert(event.kind != EventKind::Note);
  torus.setPaused(true);
  const double stopped = torus.time();
  torus.update(1);
  near(torus.time(), stopped);

  Sequencer vertex;
  reader.pose = {0, 7.5, 7.5, 1, 1};
  assert(vertex.addSequence(reader) == 0);
  events.clear();
  run(vertex, 1, 0.01, events);
  assert(!vertex.sequence(0).running);
  assert(events.size() == 1 && events[0].kind == EventKind::Vertex);

  assert(!instrument.setTempo(std::numeric_limits<double>::quiet_NaN()));
  assert(!instrument.setCell({7, 0, 0}, 90));
  reader.pose.dx = 0;
  reader.pose.dy = 0;
  assert(instrument.addSequence(reader) == -1);
  reader.pose.dx = 1;
  reader.rate = -1;
  assert(instrument.addSequence(reader) == -1);
  instrument.setPaused(false);
  instrument.update(1);
  assert(instrument.overruns() == 1);
  Sequencer reversal;
  reader.pose = {0, 7.5, 3.5, 1, 0};
  reader.rate = 1;
  assert(reversal.addSequence(reader) == 0);
  reversal.setPaused(false);
  reversal.update(0.25);
  assert(reversal.sequence(0).pose.face == 4);   // face 0 (+Z) +x edge -> face 4 (+X)
  assert(reversal.reverse(0));
  reversal.update(0.25);
  assert(reversal.sequence(0).pose.face == 0);
  near(reversal.sequence(0).pose.x, 7.5);
  near(reversal.sequence(0).pose.y, 3.5);

  Modes::State mode;
  Demo::load(instrument);
  assert(instrument.sequenceCount() == 25 && instrument.bandCount() == 3);
  const Pose savedPose = instrument.sequence(0).pose;
  auto result = Commands::apply(instrument, mode, {Commands::Kind::Mode, unsigned(Modes::Kind::TopologyWalk)});
  assert(result.accepted && result.silence);
  Modes::update(mode, 0.25, 384, 384);
  near(instrument.sequence(0).pose.x, savedPose.x);
  assert(mode.diagnostic.walker.sequence(0).pose.x > 0.5);
  Commands::apply(instrument, mode, {Commands::Kind::Mode, unsigned(Modes::Kind::SurfaceAxes)});
  Presentation::SurfaceFrame frame;
  Presentation::draw(instrument, mode, frame);
  assert(frame[instrument.surface().index({0,1,0})].green == 255);
  assert(frame[instrument.surface().index({0,0,1})].red == 255);
  near(instrument.sequence(0).pose.x, savedPose.x);
  result = Commands::apply(instrument, mode, {Commands::Kind::Tempo, 0, 240});
  assert(result.accepted && instrument.tempo() == 240);
  result = Commands::apply(instrument, mode, {Commands::Kind::Tempo, 0, -10});
  assert(!result.accepted && instrument.tempo() == 240);
  Commands::Command command;
  for (const char* text : {"play", "pause", "toggle", "clear", "reset", "step", "tempo 140", "mode 0",
                           "brightness 16", "random 123", "reverse 0", "rate 0 2", "mute 0 1",
                           "angle 0 23", "tonic 0 62", "cell 0 1 2 90", "add 4 2.1 3.2 23 2 81"}) {
    assert(SerialProtocol::parse(text, command));
    if (command.kind != Commands::Kind::DiagnosticStep) assert(Commands::apply(instrument, mode, command).accepted);
  }
  assert(instrument.sequenceCount() == 26);
  assert(instrument.sequence(25).band == -1 && instrument.pitch(25) == 81);
  for (const char* text : {"", "unknown", "play extra", "tempo", "tempo 120 extra", "reverse nope",
                           "cell 0 256 1 90", "add 0 1 1 nan 1 60", "add 0 1 1 30 1 128"}) {
    assert(!SerialProtocol::parse(text, command));
  }
  for (const char* text : {"tempo nan", "tempo 401", "mode 99", "reverse -1", "rate 0 -1",
                           "tonic 99 60", "cell 6 0 0 80", "cell 0 8 0 80", "brightness 255",
                           "add 0 0 1 0 1 60"}) {
    assert(SerialProtocol::parse(text, command));
    assert(!Commands::apply(instrument, mode, command).accepted);
  }
  std::array<bool, PanelMapping::emitterCount> mapped{};
  uint16_t outputX = 0, outputY = 0;
  for (uint8_t face = 0; face < 6; ++face) {
    for (uint8_t row = 0; row < 8; ++row) {
      for (uint8_t column = 0; column < 8; ++column) {
        assert(PanelMapping::map(face, column, row, outputX, outputY));
        assert(outputX < 48 && outputY < 8);
        const unsigned index = outputY * 48 + outputX;
        assert(!mapped[index]);
        mapped[index] = true;
      }
    }
  }
  for (bool visited : mapped) assert(visited);
  assert(!PanelMapping::map(6, 0, 0, outputX, outputY));
  assert(!PanelMapping::map(0, 8, 0, outputX, outputY));
  assert(!PanelMapping::map(0, 0, 8, outputX, outputY));

  Sequencer torusCorner(torusSurface());
  reader.pose = {0, 7.5, 7.5, 1, 1};
  reader.band = -1;
  reader.rate = 1;
  assert(torusCorner.addSequence(reader) == 0);
  events.clear();
  run(torusCorner, 1, 0.01, events);
  assert(torusCorner.sequence(0).running);
  assert(torusCorner.sequence(0).pose.x < 1 && torusCorner.sequence(0).pose.y < 1);
  for (const auto& event : events) assert(event.kind != EventKind::Vertex);
  Sequencer full, restored;
  band.degreeCount = 12;
  band.muted = true;
  for (unsigned degree = 0; degree < 12; ++degree) band.intervals[degree] = degree;
  for (unsigned index = 0; index < maxBands; ++index) assert(full.addBand(band) == int(index));
  for (unsigned index = 0; index < maxSequences; ++index) {
    reader.pose = {uint8_t(index % 6), 2.1, 3.2, 1, 0.37};
    reader.band = index % maxBands;
    reader.degree = index;
    reader.transpose = -12;
    reader.instrument = 9;
    reader.muted = index % 2;
    assert(full.addSequence(reader) == int(index));
  }
  full.randomize(123);
  run(full, 1, 0.01, events);
  DynamicJsonDocument document(SessionCodec::capacity);
  assert(SessionCodec::encode(full, document));
  std::string json;
  serializeJson(document, json);
  assert(json.size() < 24576);
  document.clear();
  assert(!deserializeJson(document, json));
  assert(SessionCodec::decode(document.as<JsonVariantConst>(), restored));
  assert(restored.sequenceCount() == maxSequences && restored.bandCount() == maxBands);
  assert(restored.paused() && restored.time() == 0);
  for (unsigned index = 0; index < maxSequences; ++index) {
    const auto& saved = full.sequence(index);
    const auto& loaded = restored.sequence(index);
    near(loaded.pose.x, saved.home.x);
    near(loaded.pose.y, saved.home.y);
    near(loaded.pose.dx, saved.home.dx);
    near(loaded.pose.dy, saved.home.dy);
    assert(loaded.pose.face == saved.home.face && loaded.muted == saved.muted);
    assert(loaded.instrument == 9 && loaded.transpose == -12 && loaded.degree == index);
    assert(restored.pitch(index) == full.pitch(index));
  }
  for (unsigned index = 0; index < 384; ++index) {
    const Cell cell{uint8_t(index / 64), uint8_t(index % 8), uint8_t(index % 64 / 8)};
    assert(restored.velocity(cell) == full.velocity(cell));
  }
  document["version"] = 2;
  assert(!SessionCodec::decode(document.as<JsonVariantConst>(), restored));
  assert(!deserializeJson(document, json));
  document["readers"][0]["band"] = 8;
  assert(!SessionCodec::decode(document.as<JsonVariantConst>(), restored));
  assert(!deserializeJson(document, json));
  document["readers"][0]["dx"] = 0;
  document["readers"][0]["dy"] = 0;
  assert(!SessionCodec::decode(document.as<JsonVariantConst>(), restored));
  assert(!deserializeJson(document, json));
  document["score"][0] = 128;
  assert(!SessionCodec::decode(document.as<JsonVariantConst>(), restored));
  assert(!SessionCodec::encode(torusCorner, document));
  std::cout << "PASS: full-capacity session round trip, home reset, malformed sessions rejected\n";
  std::cout << "PASS: USB command validation, 384-cell mapping bijection, periodic torus corner\n";
  std::cout << "PASS: cube loops, oblique timestep invariance, bands, torus, notes, mute, pause, vertices, validation\n";
  std::cout << "PASS: boundary reversal, independent diagnostics, read-only presentation, shared commands, 25-reader demo\n";
}