
import themidibus.*; //Import the library
MidiBus myBus; // The MidiBus
Note note;
int channel =1;

PFont fontA; // to display alphanumeric data

//int[] gamme={67, 69, 72,74,77};
int[] gamme={61, 63, 66, 68, 70}; 

// 3d view, or 2d (developped):
boolean imageMode3D=true;

// All the ball objects: 
classTetra[] tetraball=new classTetra[3*4]; // groups of lights, each turning around each axis of the cube (3 axis)

// The polyhedron:
classPoly polyhedron; //Contains mixed topological, geometrical and displaying attribute data)

// ball circuits (rem: circuit can be any size!!!), as a list of face indexes (face index goes from 0 to polyhedron.length-1)
// We will start with only three different kind of circuits
int[] Xcircuit={1, 5, 3, 4};
int[] Ycircuit={0, 1, 2, 3};
int[] Zcircuit={1, 1, 1, 1};

// variables for drawing the cube carrillon:
PImage[] tex=new PImage[6]; //define 6 pointers to PImage objects, that will contain the face data to create textures.

float rotx = PI/4;
float roty = PI/4;

void setup() {
  size(1000, 800, P3D);
  background(0);
  smooth(); //rem: smooth does not work in OPENGL rendering mode


  // this is important (if not made here, it should be done at the drawing method of the ball...)
  rectMode(CORNER); //CENTER);


  //load text font:
  fontA= loadFont("BankGothic-Medium-14.vlw"); //the font should be in the "data" folder of the sketch
  textAlign(LEFT);
  textFont(fontA);

  // MIDI: 
  MidiBus.list(); // List all available Midi devices on STDOUT. This will show each device's index and name.

  // Either you can
  //                   Parent In Out
  //                     |    |  |
  myBus = new MidiBus(this, 1, 1); // Create a new MidiBus using the device index to select the Midi input and output devices respectively.

  // or you can ...
  //                   Parent         In                   Out
  //                     |            |                     |
  //myBus = new MidiBus(this, "IncomingDeviceName", "OutgoingDeviceName"); // Create a new MidiBus using the device names to select the Midi input and output devices respectively.

  // or for testing you could ...
  //                 Parent  In        Out
  //                   |     |          |
  // myBus = new MidiBus(this, -1, "Java Sound Synthesizer"); // Create a new MidiBus with no input device and the default Java Sound Synthesizer as the output device.


  // Instantiate the polyhedron (i.e., the edges and face objects). We will use auxiliary objects and variables for clarity only.
  // * First, the number of faces:
  int totalnumFaces=6;
  // * Face geometry (faces are placed on the screen arbitrarily. Here, they form a cross with a short horizontal arm) 
  classFaceGeom[] auxfacegeom=new classFaceGeom[totalnumFaces];
  int faceSize=floor(1.0*height/7);

  // variables for drawing the cube carrillon:
  //PImage[] tex=new PImage[6]; //define 6 pointers to PImage objects, that will contain the face data to create textures.
  // allocate the memory for the images of faces (perhaps not necessary):
  for (int i=0; i<tex.length; i++) { 
    tex[i]=new PImage(faceSize, faceSize);
  }

  float auxy=1.0*(height-4*faceSize)/2;
  for (int i=0; i<4; i++) { // the first four faces are aligned vertically
    // rem: the constructor parameters are:  classFaceGeom(int indexface, float posx, float posy, color coled, color colfil, float siz)
    auxfacegeom[i]=new classFaceGeom(i, (1.0*width/2-faceSize)/2, auxy+i*faceSize, color(100, 0, 0), color(130, 130, 130), faceSize);
  }
  // the rest of the horizontal arm:
  auxfacegeom[4]=new classFaceGeom(4, (1.0*width/2-faceSize)/2-faceSize, auxy+faceSize, color(100, 0, 0), color(130, 130, 130), faceSize);
  auxfacegeom[5]=new classFaceGeom(5, (1.0*width/2-faceSize)/2+faceSize, auxy+faceSize, color(100, 0, 0), color(130, 130, 130), faceSize);
  // * Graph of connecting edges, and transformation operations:
  classFaceGraph[] auxfacegraph=new classFaceGraph[totalnumFaces];
  int[][] auxedgeconnection={{ 5, 1, 4, 3}, {5, 2, 4, 0}, { 5, 3, 4, 1}, {5, 0, 4, 2}, {1, 2, 3, 0}, {3, 2, 1, 0}};
  int[][] auxtransformSpeed={{ 1, 0, -1, 0}, {0, 0, 0, 0}, {-1, 0, 1, 0}, {2, 0, 2, 0}, {0, -1, 2, 1}, {2, 1, 0, -1}};
  int[][] auxtransformPos=  {{1, 0, -1, 0}, {0, 0, 0, 0}, { -1, 0, 1, 0}, {2, 0, 2, 0}, {0, -1, 2, 1}, {2, 1, 0, -1}};
  for (int i=0; i<totalnumFaces; i++) {
    // first, instantiation of the auxfacegraph[i] object:
    auxfacegraph[i]=new classFaceGraph();
    auxfacegraph[i].edge=new int[6];
    auxfacegraph[i].transformPos=new int[6];
    auxfacegraph[i].transformSpeed=new int[6];
    arrayCopy(auxedgeconnection[i], auxfacegraph[i].edge);
    arrayCopy(auxtransformSpeed[i], auxfacegraph[i].transformSpeed);
    arrayCopy(auxtransformPos[i], auxfacegraph[i].transformPos);
  }

  //Finally, we can instantiate the polyhedron object:
  polyhedron=new classPoly(totalnumFaces, auxfacegeom, auxfacegraph);


  //Instantiation of the balls (in the draw function, the speed and "delay" of the ball "metronomes" should be modifiable interactively
  // X:
  for (int i = 0; i < tetraball.length/3; i++) {
    //Note auxnote=new Note(50,30,200);
    //instantiate each tetra-ball object, using constructor (initface, position x, position y, speed x, speed y, size, color, circuit, note):
    // (rem: position is relative to the center of the CURRENT face)
    float ballsize=faceSize/tetraball.length*3;
    tetraball[i]=new classTetra(4, -1.0*faceSize/2+ballsize/2, -1.0*faceSize/2+ballsize*i+ballsize/2, floor(2*random(1, 4)), 0, ballsize, color(random(0, 255), random(0, 255), random(0, 255)), Xcircuit);//, auxnote);
    //tetraball[i]=new classTetra(4, 0,-1.0*faceSize/2+ballsize*i,0,0, ballsize, color(random(0,255),random(0,255), random(0,255)), Xcircuit, auxnote);
  }

  //Y:
  for (int i = 0; i < tetraball.length/3; i++) {
    //Note auxnote=new Note(30,30,100);
    //instantiate each tetra-ball object, using constructor (initface, position x, position y, speed x, speed y, size, color, circuit, note):
    float ballsize=faceSize/tetraball.length*3;
    tetraball[i+tetraball.length/3]=new classTetra(0, ballsize*i-faceSize/2+ballsize/2, -faceSize/2+ballsize/2, 0, floor(2*random(1, 4)), ballsize, color(random(0, 255), random(0, 255), random(0, 255)), Ycircuit);//, auxnote);
  }
  //"circular":
  //Z:
  for (int i = 0; i < tetraball.length/3; i++) {
    // Note auxnote=new Note(350,100,100);
    //instantiate each ball object, using constructor (initface, position x, position y, speed x, speed y, size, color, circuit, note):
    float ballsize=faceSize/tetraball.length*3;
    tetraball[i+2*tetraball.length/3]=new classTetra(2, -faceSize/2+ballsize/2, -faceSize/2+ballsize*i+ballsize/2, floor(2*random(1, 4)), 0, ballsize, color(random(0, 255), random(0, 255), random(0, 255)), Zcircuit);//, auxnote);
  }

  frameRate(30);//120);
}


void draw() {
  //delete (or face) the background:

  background(0, 0, 0);
  //fill(0,5);
  // rect(0,0,width,height);


  //draw the faces on the screen (flat):
  for (int i = 0; i < polyhedron.numFaces; i++) {
    polyhedron.faceGeom[i].display();
  }

  //move and update the balls:
  for (int i = 0; i < tetraball.length; i++) {
    tetraball[i].move();
    tetraball[i].display();

    if (tetraball[i].faceExitGlobal==true) {
      // playNote(gamme[i%5]-61, 60, 150); 
      playNote(20, 100, 150);//
    }
    
  }

  detectCollision();

  // Extract portions of the screen (the faces), create textures, and map on a rotating cube:
  if (imageMode3D) TexturedCube();
}

void mouseDragged() {
  float rate = 0.01;
  rotx += (pmouseY-mouseY) * rate;
  roty += (mouseX-pmouseX) * rate;
}

void keyPressed() {
  if (key==' ') {
    imageMode3D=!imageMode3D; 
    playNote(20, 100, 150);
  }
}


void playNote(int pitch, int vel, int lenTicks) {
  // note = new Note(gamme[myNumber%5]-24+12*(myNumber%4),127,1500);//int(xPos/5f),100,1000);//int(yPos/10f)+60,1000));//int(random(1000)));
  //myBus.sendNoteOn(channel, pitch, vel);//, lenTicks); // Send a Midi noteOn
  //delay(200);
  //myBus.sendNoteOff(channel, pitch, vel);
  note=new Note(pitch, vel, lenTicks);//(63,120,1500);
  // note=new Note(100, 50, 15);
  myBus.sendNoteOn(note);
}

void delay(int time) {
  int current = millis();
  while (millis () < current+time) Thread.yield();
}
