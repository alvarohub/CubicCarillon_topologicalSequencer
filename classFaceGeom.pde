class classFaceGeom {
  //in this first example, the faces are SQUARES:
  int indexFace=0;
  float x=0, y=0; // position of CORNER of the face
  float edgeWeight=1;
  color colEdge=color(200, 200, 200);
  color colFill=color(100, 100, 100); // color of the face 
  int sizeSide; // size of the square

  // constructor method (some parameters are left aside):
  classFaceGeom(int indexface, float posx, float posy, color coled, color colfil, int siz) {
    x=posx; 
    y=posy;
    colEdge=coled;
    colFill=colfil;
    sizeSide=siz;
    indexFace=indexface;
  }

  // drawing method:
  void display() {
    stroke(colEdge);
    rectMode(CORNER);
    strokeWeight(edgeWeight);
   // fill(colFill);
   noFill();
    rect(x, y, sizeSide, sizeSide);

    //face index:
    //fill(255,0,0);
    //rect(x,y,16, 16);
    //fill(0, 0, 0);
    //text(""+indexFace, x+3, y+4, 15.0, 15.0);
  }

  //content extraction method (to create texture):
  PImage extractFace() {
    imageMode(CORNER);
    //PImage cp =get(mouseX,height-mouseY-sizeSide,sizeSide,sizeSide);
    PImage cp=get(floor(x), floor(height-y-sizeSide), sizeSide, sizeSide);//get(floor(x),floor(y+sizeSide),sizeSide,sizeSide);
    return(cp);
  }
}
