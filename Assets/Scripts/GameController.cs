using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Rendering.PostProcessing;

public class GameController : MonoBehaviour
{
    //character movement
    public int speed;
    public float jumpForce;
    private float movementDirection;
    private Rigidbody2D rb;
    private bool DirectionIsRight = true;

    private bool floor;
    private bool wall;
    [SerializeField] private Transform floorCheck;
    [SerializeField] private Transform wallCheck;
    [SerializeField] private float radiusCheck;
    [SerializeField] private LayerMask whatIsFloor;
    [SerializeField] private LayerMask whatIsWall;

    private int extraJump;
    public int extraJumpNum;

    //collision stuff
    private int points = 0;
    //audio
    [SerializeField] private AudioSource jumpSound;
    [SerializeField] private AudioSource pickupCoinSound;
    [SerializeField] private AudioSource onDeathSound;
    [SerializeField] private AudioSource smallSizeSound;
    [SerializeField] private AudioSource normalSizeSound;
    [SerializeField] private AudioSource bigSizeSound;
    [SerializeField] private AudioSource noGravitySound;
    [SerializeField] private AudioSource GravitySound;

    static private bool gameFinished = false;
    [SerializeField] private GameObject finishText;

    private void Start()
    {
        rb = GetComponent<Rigidbody2D>();
        if (SceneManager.GetActiveScene().name == "testing") { GameObject.Find("LevelText").GetComponent<TMPro.TextMeshProUGUI>().text = "Test Level"; }
        else { GameObject.Find("LevelText").GetComponent<TMPro.TextMeshProUGUI>().text = "Level: " + SceneManager.GetActiveScene().buildIndex; }
    }

    private void Update()
    {
        if ((Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.W) || Input.GetKeyDown(KeyCode.UpArrow)) && extraJump > 0)
        {
            rb.velocity = Vector2.up * jumpForce;
            jumpSound.Play();
            extraJump--;
        }
        if (floor == true) { extraJump = extraJumpNum; }
        if (wall == true) { extraJump = 1; }
        else if ((Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.W) || Input.GetKeyDown(KeyCode.UpArrow)) && extraJump == 0 && floor == true)
        {
            rb.velocity = Vector2.up * jumpForce;
            jumpSound.Play();
        }
        if (gameFinished == true && Input.GetKeyDown(KeyCode.F1))
        {
            Time.timeScale = 1;
            SceneManager.LoadScene("MainMenu");
        }
        if (Input.GetKey(KeyCode.R)) { SceneManager.LoadScene(SceneManager.GetActiveScene().name); }
    }

    private void FixedUpdate()
    {
        floor = Physics2D.OverlapCircle(floorCheck.position, radiusCheck, whatIsFloor);
        wall = Physics2D.OverlapCircle(wallCheck.position, radiusCheck, whatIsWall);
        movementDirection = Input.GetAxis("Horizontal");
        rb.velocity = new Vector2(movementDirection * speed, rb.velocity.y);
        if (DirectionIsRight == false && movementDirection > 0)
        {
            Flip();
        }
        else if (DirectionIsRight == true && movementDirection < 0)
        {
            Flip();
        }
        if (Input.GetKey(KeyCode.V))
        {
            Time.timeScale = 0.4f;
        }
        else
        {
            Time.timeScale = 1.0f;
        }
    }

    private void Flip()
    {
        DirectionIsRight = !DirectionIsRight;
        Vector3 Scaler = transform.localScale;
        Scaler.x *= -1;
        transform.localScale = Scaler;
    }

    //collisions
    private void OnTriggerEnter2D(Collider2D collision)
    {
        var pt = GameObject.FindGameObjectsWithTag("point");
        if (collision.name.Contains("Point"))
        {
            points++;
            GameObject.Find("PointText").GetComponent<TMPro.TextMeshProUGUI>().text = "Points: " + points;
            pickupCoinSound.Play();
            Destroy(collision.gameObject);
        }
        if (collision.name.Equals("fall"))
        {
            SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
            onDeathSound.Play();
        }
        if (collision.name.Equals("win"))
        {
            if (pt.Length == 0)
            {
                if (SceneManager.GetActiveScene().buildIndex + 2 > SceneManager.sceneCountInBuildSettings)
                {
                    finishText.SetActive(true);
                    gameFinished = true;
                    Time.timeScale = 0;
                }
                else if (SceneManager.GetActiveScene().buildIndex + 1 < SceneManager.sceneCountInBuildSettings)
                {
                    SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex + 1);
                }
            }

        }
        if (collision.tag.Equals("PowerUp"))
        {
            if (collision.name.Equals("smallSize"))
            {
                gameObject.transform.localScale = new Vector2(0.5f, 0.5f);
                rb.mass = 0.5f;
                smallSizeSound.Play();
                Destroy(collision.gameObject);
            }
            else if (collision.name.Equals("normalSize"))
            {
                gameObject.transform.localScale = new Vector2(1, 1);
                rb.mass = 1f;
                normalSizeSound.Play();
                Destroy(collision.gameObject);
            }
            else if (collision.name.Equals("bigSize"))
            {
                gameObject.transform.localScale = new Vector2(2, 2);
                rb.mass = 4f;
                bigSizeSound.Play();
                Destroy(collision.gameObject);
            }
            else if (collision.name.Equals("noGravity"))
            {
                rb.gravityScale = -0.1f;
                noGravitySound.Play();
                Destroy(collision.gameObject);
            }
            else if (collision.name.Equals("Gravity"))
            {
                rb.gravityScale = 1.4f;
                GravitySound.Play();
                Destroy(collision.gameObject);
            }
        }
    }
}
