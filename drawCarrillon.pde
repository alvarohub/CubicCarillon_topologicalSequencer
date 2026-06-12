
void TexturedCube() {

  //auxiliary PImage texture:
  //PImage auxtex=new PImage(polyhedron.faceGeom[0].sizeSide,polyhedron.faceGeom[0].sizeSide);
  //int[] transparency=new int[polyhedron.faceGeom[0].sizeSide*polyhedron.faceGeom[0].sizeSide];
  //for (int i=0;i<transparency.length;i++) transparency[i]=200;

  //add transparency to the texture:
  //tint(255,255,255,200);

  //get the six textures from the current image of flattened cube, BEFORE doing the rotation and scaling (is this realy important? the image is grabbed from the framebuffer!):
  //polyhedron.faceGeom[3].extractFace();
  //println("mouseX: "+mouseX+" mouseY: "+mouseY);

  // get all the textures here (conversely, this can be done between each beginShape/edShape, without resorting to the tex[] array)
  for (int i=0; i<6; i++) tex[i]=polyhedron.faceGeom[i].extractFace();

  //clear image of expanded cube:
 fill(200, 200, 200, 255);
 rect(0, 0, width, height);


  pushMatrix();
  //translate(3.0/4*width, height/2.0, -80);
  translate(width/2, height/2.0, 300);
  rotateX(rotx);
  rotateY(roty);
 scale(100);



  // +Z "front" face
  textureMode(NORMAL);
  beginShape(QUADS);
  // texture(polyhedron.faceGeom[1].extractFace());
  texture(tex[1]);
  vertex(-1, -1, 1, 0, 0);
  vertex( 1, -1, 1, 1, 0);
  vertex( 1, 1, 1, 1, 1);
  vertex(-1, 1, 1, 0, 1);
  endShape();

  // -Z "back" face
  beginShape(QUADS);
  // texture(polyhedron.faceGeom[3].extractFace());
  texture(tex[3]);
  vertex( 1, -1, -1, 1, 1);
  vertex(-1, -1, -1, 0, 1);
  vertex(-1, 1, -1, 0, 0);
  vertex( 1, 1, -1, 1, 0);
  endShape();

  // +Y "bottom" face
  beginShape(QUADS);
  // texture(polyhedron.faceGeom[2].extractFace());
  texture(tex[2]);
  vertex(-1, 1, 1, 0, 0);
  vertex( 1, 1, 1, 1, 0);
  vertex( 1, 1, -1, 1, 1);
  vertex(-1, 1, -1, 0, 1);
  endShape();

  // -Y "top" face
  beginShape(QUADS);
  //texture(polyhedron.faceGeom[0].extractFace());
  texture(tex[0]);
  vertex(-1, -1, -1, 0, 0);
  vertex( 1, -1, -1, 1, 0);
  vertex( 1, -1, 1, 1, 1);
  vertex(-1, -1, 1, 0, 1);
  endShape();

  // +X "right" face
  beginShape(QUADS);
  // texture(polyhedron.faceGeom[5].extractFace());
  texture(tex[5]);
  vertex( 1, -1, 1, 0, 0);
  vertex( 1, -1, -1, 1, 0);
  vertex( 1, 1, -1, 1, 1);
  vertex( 1, 1, 1, 0, 1);
  endShape();

  // -X "left" face
  beginShape(QUADS);
  // texture(polyhedron.faceGeom[4].extractFace());
  texture(tex[4]);
  vertex(-1, -1, -1, 0, 0);
  vertex(-1, -1, 1, 1, 0);
  vertex(-1, 1, 1, 1, 1);
  vertex(-1, 1, -1, 0, 1);
  endShape();

  popMatrix();
}
